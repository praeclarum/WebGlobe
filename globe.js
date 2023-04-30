import "./gl-matrix.js";
const mat4 = glMatrix.mat4;
const vec3 = glMatrix.vec3;

function sphere2cart(point, aboveSea) {
    const lngr = (point.Longitude * Math.PI) / 180;
    const latr = (point.Latitude * Math.PI) / 180;
    const EarthRadius = 1.0;
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

function createLinesBuffer(device, createLines) {
    var vertexArray = [];
    function addLine(fromPoint, toPoint, aboveSea) {
        const f = sphere2cart(fromPoint, aboveSea);
        const t = sphere2cart(toPoint, aboveSea);
        vertexArray.push(f[0], f[1], f[2], 1);
        vertexArray.push(t[0], t[1], t[2], 1);
    }
    createLines(addLine)
    const floatVertexArray = new Float32Array(vertexArray);
    const verticesBuffer = device.createBuffer({
        size: floatVertexArray.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(verticesBuffer.getMappedRange()).set(floatVertexArray);
    verticesBuffer.unmap();
    return verticesBuffer;
}

function createDebugVertices(device) {
    return createLinesBuffer(device, addLine => {
        addLine({ Longitude: 0, Latitude: 90 }, { Longitude: 0, Latitude: -90 }, 1);
    });
}

function createLatLngLines(device) {
    return createLinesBuffer(device, addLine => {
        const bigSep = 15;
        const litSep = 1;
        // Draw lines of latitude
        for (let lat = -90; lat <= 90; lat += bigSep) {
            for (let lng = -180; lng <= 180; lng += litSep) {
                addLine({ Longitude: lng, Latitude: lat }, { Longitude: lng + litSep, Latitude: lat }, 0);
            }
        }
        // Draw lines of longitude
        for (let lng = -180; lng <= 180; lng += bigSep) {
            for (let lat = -90; lat <= 90; lat += litSep) {
                addLine({ Longitude: lng, Latitude: lat }, { Longitude: lng, Latitude: lat + litSep }, 0);
            }
        }
    });
}

function loadShpLineVertices(device, shp) {
    var vertexArray = [];
    function addLine(fromPoint, toPoint) {
        const f = sphere2cart(fromPoint, 0);
        const t = sphere2cart(toPoint, 0);
        vertexArray.push(f[0], f[1], f[2], 1);
        vertexArray.push(t[0], t[1], t[2], 1);
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
    const basicVertWGSL = await (await fetch("globe.vert.wgsl")).text();
    const vertexPositionColorWGSL = await (
        await fetch("globe.frag.wgsl")
    ).text();
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const context = canvas.getContext("webgpu");

    const sampleCount = 4;

    const devicePixelRatio = window.devicePixelRatio || 1;
    const initWidth = canvas.clientWidth * devicePixelRatio;
    const initHeight = canvas.clientHeight * devicePixelRatio;
    canvas.width = initWidth;
    canvas.height = initHeight;
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
        multisample: {
            count: sampleCount,
        },
    });

    const uniformBufferSize = 3 * (4 * 4 * 4); // 2 4x4 matrices
    const uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup0UniformLayout = pipeline.getBindGroupLayout(0);
    const uniformBindGroup = device.createBindGroup({
        layout: bindGroup0UniformLayout,
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
            view: undefined, // Assigned later

            depthClearValue: 1.0,
            depthLoadOp: "clear",
            depthStoreOp: "store",
        },
    };

    function getTransformationMatrix(t) {
        const viewMatrix = mat4.create();
        mat4.translate(viewMatrix, viewMatrix, vec3.fromValues(0, 0, -15));
        const rotationSpeed = 2.0 * Math.PI / (60.0 * 60.0 * 24.0);
        const axisSpeed = 2.0 * Math.PI / (60.0 * 60.0 * 24.0 * 365.0);
        const timeSpeedup = 1000.0;
        mat4.rotate(
            viewMatrix,
            viewMatrix,
            (axisSpeed * timeSpeedup * t) + Math.PI / 2.0,
            vec3.fromValues(0, 1, 0)
        );
        mat4.rotate(
            viewMatrix,
            viewMatrix,
            23.5 * (Math.PI / 180),
            vec3.fromValues(0, 0, 1)
        );
        mat4.rotate(
            viewMatrix,
            viewMatrix,
            rotationSpeed * timeSpeedup * t,
            vec3.fromValues(0, 1, 0)
        );
        return viewMatrix;
    }

    const coastlinesVerticesBuffer = loadShpLineVertices(device, coastlines);
    const coastlinesVertexCount = coastlinesVerticesBuffer.size / vertexSize;
    const countriesVerticesBuffer = loadShpLineVertices(device, countries);
    const countriesVertexCount = countriesVerticesBuffer.size / vertexSize;
    const debugVerticesBuffer = createDebugVertices(device);
    const debugVertexCount = debugVerticesBuffer.size / vertexSize;
    const latlngVerticesBuffer = createLatLngLines(device);
    const latlngVertexCount = latlngVerticesBuffer.size / vertexSize;

    let renderTarget = undefined;
    let renderTargetView = undefined;
    let depthTexture = undefined;
    let depthTextureView = undefined;

    function resizeBuffersIfNeeded() {
        let currentWidth = canvas.clientWidth * devicePixelRatio;
        let currentHeight = canvas.clientHeight * devicePixelRatio;
        const maxTextureSize = device.limits.maxTextureDimension2D;
        const scaleX = currentWidth > maxTextureSize ? maxTextureSize / currentWidth : 1;
        const scaleY = currentHeight > maxTextureSize ? maxTextureSize / currentHeight : 1;
        const scale = Math.min(scaleX, scaleY);
        currentWidth = Math.round(scale * currentWidth);
        currentHeight = Math.round(scale * currentHeight);

        // The canvas size is animating via CSS.
        // When the size changes, we need to reallocate the render target.
        // We also need to set the physical size of the canvas to match the computed CSS size.
        if ((currentWidth !== canvas.width || currentHeight !== canvas.height || renderTarget === undefined || depthTexture === undefined) &&
            currentWidth &&
            currentHeight
            ) {
            if (renderTarget !== undefined) {
                // Destroy the previous render target
                renderTarget.destroy();
            }
            if (depthTexture !== undefined) {
                // Destroy the previous render target
                depthTexture.destroy();
            }

            // Setting the canvas width and height will automatically resize the textures returned
            // when calling getCurrentTexture() on the context.
            canvas.width = currentWidth;
            canvas.height = currentHeight;

            // Resize the multisampled render target to match the new canvas size.
            renderTarget = device.createTexture({
                size: [canvas.width, canvas.height],
                sampleCount,
                format: presentationFormat,
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });

            renderTargetView = renderTarget.createView();

            depthTexture = device.createTexture({
                size: [canvas.width, canvas.height],
                sampleCount,
                format: "depth24plus",
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
        
            depthTextureView = depthTexture.createView();
        }
    }

    // Start rendering time
    const startTime = Date.now() / 1000;
    
    async function frame() {
        resizeBuffersIfNeeded();
        const t = Date.now() / 1000 - startTime;
        
        const aspect = canvas.width / canvas.height;
        const projectionMatrix = mat4.create();
        mat4.perspective(projectionMatrix, Math.PI / 20, aspect, 0.1, 100.0);
        
        const modelViewMatrix = getTransformationMatrix(t);
        const normModelViewMatrix = mat4.copy(mat4.create(), modelViewMatrix);
        normModelViewMatrix[12] = 0;
        normModelViewMatrix[13] = 0;
        normModelViewMatrix[14] = 0;
        mat4.invert(normModelViewMatrix, normModelViewMatrix);
        mat4.transpose(normModelViewMatrix, normModelViewMatrix);

        const modelViewProjectionMatrix = mat4.create();
        mat4.multiply(modelViewProjectionMatrix, projectionMatrix, modelViewMatrix);
    
        device.queue.writeBuffer(
            uniformBuffer,
            0,
            modelViewMatrix,
            0,
            16
        );
        device.queue.writeBuffer(
            uniformBuffer,
            64,
            projectionMatrix,
            0,
            16
        );
        device.queue.writeBuffer(
            uniformBuffer,
            2*64,
            normModelViewMatrix,
            0,
            16
        );
        renderPassDescriptor.colorAttachments[0].view = renderTargetView;
        renderPassDescriptor.colorAttachments[0].resolveTarget = context.getCurrentTexture().createView();
        renderPassDescriptor.depthStencilAttachment.view = depthTextureView;

        const commandEncoder = device.createCommandEncoder();
        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, uniformBindGroup);
        passEncoder.setVertexBuffer(0, coastlinesVerticesBuffer);
        passEncoder.draw(coastlinesVertexCount, 1, 0, 0);
        passEncoder.setVertexBuffer(0, countriesVerticesBuffer);
        passEncoder.draw(countriesVertexCount, 1, 0, 0);
        passEncoder.setVertexBuffer(0, debugVerticesBuffer);
        passEncoder.draw(debugVertexCount, 1, 0, 0);
        passEncoder.setVertexBuffer(0, latlngVerticesBuffer);
        passEncoder.draw(latlngVertexCount, 1, 0, 0);
        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
};
