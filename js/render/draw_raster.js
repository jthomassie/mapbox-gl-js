'use strict';

var TileCoord = require('../source/tile_coord');
var PrerenderedTexture = require('./prerendered');
var mat4 = require('gl-matrix').mat4;
var util = require('../util/util');

module.exports = drawRaster;
module.exports.prerendered = drawPrerendered;

function drawPrerendered(painter, layer, layerStyle, tiles) {
    var gl = painter.gl;

    tiles.forEach(function (tile) {
        var bucket = tile.buckets[layer.ref || layer.id];
        if (!bucket)
            return;

        var layoutProperties = bucket.layoutProperties;
        var texture = bucket.prerendered;

        if (!texture) {
            texture = bucket.prerendered = new PrerenderedTexture(gl, layoutProperties, painter);
            texture.bindFramebuffer();

            gl.clearStencil(0x80);
            gl.stencilMask(0xFF);
            gl.clear(gl.STENCIL_BUFFER_BIT | gl.COLOR_BUFFER_BIT);
            gl.stencilMask(0x00);

            gl.viewport(0, 0, texture.size, texture.size);

            var buffer = texture.buffer * 4096;
            var matrix = mat4.create();
            mat4.ortho(matrix, -buffer, 4096 + buffer, -4096 - buffer, buffer, 0, 1);
            mat4.translate(matrix, matrix, [0, -4096, 0]);

            tile = Object.create(tile);
            tile.posMatrix = matrix;

            painter.renderLayers(layer.layers, tile);

            if (layoutProperties['raster-blur'] > 0) {
                texture.blur(painter, layoutProperties['raster-blur']);
            }

            texture.unbindFramebuffer();
            gl.viewport(0, 0, painter.width, painter.height);
        }

        gl.disable(gl.STENCIL_TEST);

        var shader = painter.rasterShader;
        gl.switchShader(shader);
        gl.uniformMatrix4fv(shader.u_matrix, false, tile.posMatrix);

        // color parameters
        gl.uniform1f(shader.u_brightness_low, layerStyle['raster-brightness'][0]);
        gl.uniform1f(shader.u_brightness_high, layerStyle['raster-brightness'][1]);
        gl.uniform1f(shader.u_saturation_factor, saturationFactor(layerStyle['raster-saturation']));
        gl.uniform1f(shader.u_contrast_factor, contrastFactor(layerStyle['raster-contrast']));
        gl.uniform3fv(shader.u_spin_weights, spinWeights(layerStyle['raster-hue-rotate']));

        gl.activeTexture(gl.TEXTURE0);
        texture.bind(gl);

        // cross-fade parameters
        gl.uniform2fv(shader.u_tl_parent, [0, 0]);
        gl.uniform1f(shader.u_scale_parent, 1);
        gl.uniform1f(shader.u_buffer_scale, (4096 * (1 + 2 * texture.buffer)) / 4096);
        gl.uniform1f(shader.u_opacity0, layerStyle['raster-opacity']);
        gl.uniform1f(shader.u_opacity1, 0);
        gl.uniform1i(shader.u_image0, 0);
        gl.uniform1i(shader.u_image1, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, painter.tileExtentBuffer);
        gl.vertexAttribPointer(shader.a_pos, 2, gl.SHORT, false, 8, 0);
        gl.vertexAttribPointer(shader.a_texture_pos, 2, gl.SHORT, false, 8, 4);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.enable(gl.STENCIL_TEST);
    });
}

function drawRaster(painter, layer, layerStyle, tiles) {
    var gl = painter.gl;
    var shader = painter.rasterShader;

    gl.disable(gl.STENCIL_TEST);
    gl.switchShader(shader);

    gl.uniform1f(shader.u_brightness_low, layerStyle['raster-brightness'][0]);
    gl.uniform1f(shader.u_brightness_high, layerStyle['raster-brightness'][1]);
    gl.uniform1f(shader.u_saturation_factor, saturationFactor(layerStyle['raster-saturation']));
    gl.uniform1f(shader.u_contrast_factor, contrastFactor(layerStyle['raster-contrast']));
    gl.uniform3fv(shader.u_spin_weights, spinWeights(layerStyle['raster-hue-rotate']));

    gl.uniform1i(shader.u_image0, 0);
    gl.uniform1i(shader.u_image1, 1);
    gl.uniform1f(shader.u_buffer_scale, 1);

    tiles.forEach(function (tile) {
        var parentTile = tile.source && tile.source._findLoadedParent(tile.id, 0, {});
        var opacities = getOpacities(tile, parentTile, layerStyle);
        var parentScaleBy, parentTL;

        gl.activeTexture(gl.TEXTURE0);
        tile.bind(gl);

        if (parentTile) {
            gl.activeTexture(gl.TEXTURE1);
            parentTile.bind(gl);

            var tilePos = TileCoord.fromID(tile.id);
            var parentPos = parentTile && TileCoord.fromID(parentTile.id);
            parentScaleBy = Math.pow(2, parentPos.z - tilePos.z);
            parentTL = [tilePos.x * parentScaleBy % 1, tilePos.y * parentScaleBy % 1];
        } else {
            opacities[1] = 0;
        }

        gl.uniformMatrix4fv(shader.u_matrix, false, tile.posMatrix);

        gl.uniform2fv(shader.u_tl_parent, parentTL || [0, 0]);
        gl.uniform1f(shader.u_scale_parent, parentScaleBy || 1);
        gl.uniform1f(shader.u_opacity0, opacities[0]);
        gl.uniform1f(shader.u_opacity1, opacities[1]);

        gl.bindBuffer(gl.ARRAY_BUFFER, tile.boundsBuffer || painter.tileExtentBuffer);
        gl.vertexAttribPointer(shader.a_pos,         2, gl.SHORT, false, 8, 0);
        gl.vertexAttribPointer(shader.a_texture_pos, 2, gl.SHORT, false, 8, 4);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });

    gl.enable(gl.STENCIL_TEST);
}

function spinWeights(angle) {
    angle *= Math.PI / 180;
    var s = Math.sin(angle);
    var c = Math.cos(angle);
    return [
        (2 * c + 1) / 3,
        (-Math.sqrt(3) * s - c + 1) / 3,
        (Math.sqrt(3) * s - c + 1) / 3
    ];
}

function contrastFactor(contrast) {
    return contrast > 0 ?
        1 / (1 - contrast) :
        1 + contrast;
}

function saturationFactor(saturation) {
    return saturation > 0 ?
        1 - 1 / (1.001 - saturation) :
        -saturation;
}

function getOpacities(tile, parentTile, layerStyle) {
    if (!tile.source) return [1, 0];

    var now = new Date().getTime();

    var fadeDuration = layerStyle['raster-fade-duration'];
    var sinceTile = (now - tile.timeAdded) / fadeDuration;
    var sinceParent = parentTile ? (now - parentTile.timeAdded) / fadeDuration : -1;

    var tilePos = TileCoord.fromID(tile.id);
    var parentPos = parentTile && TileCoord.fromID(parentTile.id);

    var idealZ = tile.source._coveringZoomLevel();
    var parentFurther = parentTile ? Math.abs(parentPos.z - idealZ) > Math.abs(tilePos.z - idealZ) : false;

    var opacity = [];
    if (!parentTile || parentFurther) {
        // if no parent or parent is older
        opacity[0] = util.clamp(sinceTile, 0, 1);
        opacity[1] = 1 - opacity[0];
    } else {
        // parent is younger, zooming out
        opacity[0] = util.clamp(1 - sinceParent, 0, 1);
        opacity[1] = 1 - opacity[0];
    }

    var op = layerStyle['raster-opacity'];
    opacity[0] *= op;
    opacity[1] *= op;

    return opacity;
}
