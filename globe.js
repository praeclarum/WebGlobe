import "./gl-matrix.js";
const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;

function loadShpLineVertices(device, shp) {
    var vertexArray = [];
    function addLine(fromPoint, toPoint) {
        const f = sphere2cart(fromPoint);
        const t = sphere2cart(toPoint);
        vertexArray.push(f[0], f[1], f[2], 1);
        vertexArray.push(t[0], t[1], t[2], 1);
    }
    function sphere2cart(point) {
        const lngr = (point.Longitude * Math.PI) / 180;
        const latr = (point.Latitude * Math.PI) / 180;
        const EarthRadius = 1.0;
        const aboveSea = 0.0;
        var clat = Math.cos (latr);
        var slat = Math.sin (latr);
        const EarthFlattening = 1.0/298.257223563;
        const EarthFF = (1.0 - EarthFlattening) * (1.0 - EarthFlattening);
        var C = 1.0 / (Math.sqrt (clat*clat + EarthFF * slat*slat));
        var S = C * EarthFF;
        const x = (EarthRadius * C + aboveSea)*clat * (Math.cos (lngr));
        const y = (EarthRadius * C + aboveSea)*clat * (Math.sin (lngr));
        const z = (EarthRadius * S + aboveSea)*slat;
        return [-x, z, y];
    }
    for (const record of shp.Records) {
        const points = record.Points;
        for (let partI = 0; partI < record.Parts.length; partI++) {
            const pointStartI = record.Parts[partI];
            const pointEndI = partI < record.Parts.length - 1 ? record.Parts[partI + 1] : points.length;
            for (let i = pointStartI; i < pointEndI - 1; i++) {
                addLine(points[i], points[i + 1]);
            }
        }
    }
    const floatVertexArray = new Float32Array(vertexArray);

    // Create a vertex buffer from the cube data.
    const verticesBuffer = device.createBuffer({
        size: floatVertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(verticesBuffer.getMappedRange()).set(floatVertexArray);
    verticesBuffer.unmap();
    return verticesBuffer;
}

export const init = async (canvas) => {
    const coastlines = await (await fetch("./data/coastlines.json")).json();
    const countries = await (await fetch("./data/countries.json")).json();
    // import basicVertWGSL from '../../shaders/basic.vert.wgsl';
    // import vertexPositionColorWGSL from '../../shaders/vertexPositionColor.frag.wgsl';
    const basicVertWGSL = await (await fetch("globe.vert.wgsl")).text();
    const vertexPositionColorWGSL = await (
        await fetch("globe.frag.wgsl")
    ).text();
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const context = canvas.getContext("webgpu");

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

    context.configure({
        device,
        format: presentationFormat,
        alphaMode: "premultiplied",
    });


    const vertexSize = 4 * 4; // 4 floats per vertex

    const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
            module: device.createShaderModule({
                code: basicVertWGSL,
            }),
            entryPoint: "main",
            buffers: [
                {
                    arrayStride: vertexSize,
                    attributes: [
                        {
                            // position
                            shaderLocation: 0,
                            offset: 0,
                            format: "float32x4",
                        },
                    ],
                },
            ],
        },
        fragment: {
            module: device.createShaderModule({
                code: vertexPositionColorWGSL,
            }),
            entryPoint: "main",
            targets: [
                {
                    format: presentationFormat,
                },
            ],
        },
        primitive: {
            topology: "line-list",
        },

        // Enable depth testing so that the fragment closest to the camera
        // is rendered in front.
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: "less",
            format: "depth24plus",
        },
    });

    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const uniformBufferSize = 4 * 16; // 4x4 matrix
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const uniformBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: uniformBuffer,
                },
            },
        ],
    });

    const renderPassDescriptor = {
        colorAttachments: [
            {
                view: undefined, // Assigned later

                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: "clear",
                storeOp: "store",
            },
        ],
        depthStencilAttachment: {
            view: depthTexture.createView(),

            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
        },
    };

    const aspect = canvas.width / canvas.height;
    const projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, Math.PI / 20, aspect, 0.1, 100.0);

    function getTransformationMatrix(t) {
        const viewMatrix = mat4.create();
        mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(0, 0, -15));
        const now = Date.now() / 1000;
        mat4.rotate(
            viewMatrix,
            viewMatrix,
            0.1*t,
            vec3.fromValues(0, 1, 0)
        );

        const modelViewProjectionMatrix = mat4.create();
        mat4.multiply(modelViewProjectionMatrix, projectionMatrix, viewMatrix);

        return modelViewProjectionMatrix;
    }

    const coastlinesVerticesBuffer = loadShpLineVertices(device, coastlines);
    const coastlinesVertexCount = coastlinesVerticesBuffer.size / vertexSize;
    const countriesVerticesBuffer = loadShpLineVertices(device, countries);
    const countriesVertexCount = countriesVerticesBuffer.size / vertexSize;

    // Start rendering time
    const startTime = Date.now() / 1000;
    
    function frame() {
        const t = Date.now() / 1000 - startTime;
        const transformationMatrix = getTransformationMatrix(t);
        device.queue.writeBuffer(
            uniformBuffer,
            0,
            transformationMatrix.buffer,
            transformationMatrix.byteOffset,
            transformationMatrix.byteLength
        );
        renderPassDescriptor.colorAttachments[0].view = context
            .getCurrentTexture()
            .createView();

        const commandEncoder = device.createCommandEncoder();
        const passEncoder =
            commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, uniformBindGroup);
        passEncoder.setVertexBuffer(0, coastlinesVerticesBuffer);
        passEncoder.draw(coastlinesVertexCount, 1, 0, 0);
        passEncoder.setVertexBuffer(0, countriesVerticesBuffer);
        passEncoder.draw(countriesVertexCount, 1, 0, 0);
        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};
