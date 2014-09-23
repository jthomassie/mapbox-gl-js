'use strict';

var browser = require('../util/browser');
var mat4 = require('gl-matrix').mat4;

module.exports = drawSymbols;

function drawSymbols(painter, layer, style, tiles) {
    var gl = painter.gl;

    gl.disable(gl.STENCIL_TEST);

    drawSymbol(painter, layer, style, tiles, 'text');
    drawSymbol(painter, layer, style, tiles, 'icon');

    gl.enable(gl.STENCIL_TEST);
}

var defaultSizes = {
    icon: 1,
    text: 24
};

function drawSymbol(painter, layer, layerStyle, tiles, prefix) {
    var gl = painter.gl;

    var bucket = tiles[0].buckets[layer.ref || layer.id];
    if (!bucket)
        return;

    var layoutProperties = bucket.layoutProperties;

    var exMatrix = mat4.clone(painter.projectionMatrix);
    var alignedWithMap = layoutProperties[prefix + '-rotation-alignment'] === 'map';
    var angleOffset = (alignedWithMap ? painter.transform.angle : 0);

    if (angleOffset) {
        mat4.rotateZ(exMatrix, exMatrix, angleOffset);
    }

    // If layerStyle.size > layoutProperties[prefix + '-max-size'] then labels may collide
    var fontSize = layerStyle[prefix + '-size'] || layoutProperties[prefix + '-max-size'];
    var fontScale = fontSize / defaultSizes[prefix];
    mat4.scale(exMatrix, exMatrix, [ fontScale, fontScale, 1 ]);

    var text = prefix === 'text';
    var sdf = text || bucket.elementGroups.sdfIcons;
    var shader, texsize;

    if (!text && (!painter.sprite || !painter.sprite.loaded()))
        return;

    gl.activeTexture(gl.TEXTURE0);

    if (sdf) {
        shader = painter.sdfShader;
    } else {
        shader = painter.iconShader;
    }

    if (text) {
        painter.glyphAtlas.updateTexture(gl);
        texsize = [painter.glyphAtlas.width / 4, painter.glyphAtlas.height / 4];
    } else {
        painter.sprite.bind(gl, alignedWithMap || painter.params.rotating || painter.params.zooming || fontScale != 1 || sdf);
        texsize = [painter.sprite.img.width, painter.sprite.img.height];
    }

    gl.switchShader(shader);
    gl.uniform1i(shader.u_texture, 0);
    gl.uniform2fv(shader.u_texsize, texsize);

    // Convert the -pi..pi to an int8 range.
    var angle = Math.round(painter.transform.angle / Math.PI * 128);

    // adjust min/max zooms for variable font sies
    var zoomAdjust = Math.log(fontSize / layoutProperties[prefix + '-max-size']) / Math.LN2 || 0;

    var flip = alignedWithMap && layoutProperties[prefix + '-keep-upright'];
    gl.uniform1f(shader.u_flip, flip ? 1 : 0);
    gl.uniform1f(shader.u_angle, (angle + 256) % 256);
    gl.uniform1f(shader.u_zoom, (painter.transform.zoom - zoomAdjust) * 10); // current zoom level

    var f = painter.frameHistory.getFadeProperties(300);
    gl.uniform1f(shader.u_fadedist, f.fadedist * 10);
    gl.uniform1f(shader.u_minfadezoom, Math.floor(f.minfadezoom * 10));
    gl.uniform1f(shader.u_maxfadezoom, Math.floor(f.maxfadezoom * 10));
    gl.uniform1f(shader.u_fadezoom, (painter.transform.zoom + f.bump) * 10);

    tiles.forEach(function(tile) {
        var bucket = tile.buckets[layer.ref || layer.id];
        if (!bucket)
            return;

        if (!bucket.elementGroups[prefix].groups.length)
            return;

        var posMatrix = painter.translateMatrix(tile.posMatrix, tile.zoom,
            layerStyle[prefix + '-translate'], layerStyle[prefix + '-translate-anchor']);

        if (text) {
            bucket.buffers.glyphVertex.bind(gl, shader);
        } else {
            bucket.buffers.iconVertex.bind(gl, shader);
        }

        gl.uniformMatrix4fv(shader.u_matrix, false, posMatrix);
        gl.uniformMatrix4fv(shader.u_exmatrix, false, exMatrix);

        var begin = bucket.elementGroups[prefix].groups[0].vertexStartIndex,
            len = bucket.elementGroups[prefix].groups[0].vertexLength;

        if (sdf) {
            var sdfPx = 8;
            var blurOffset = 1.19;
            var haloOffset = 6;
            var gamma = 0.105 * defaultSizes[prefix] / fontSize / browser.devicePixelRatio;

            gl.uniform1f(shader.u_gamma, gamma);
            gl.uniform4fv(shader.u_color, layerStyle[prefix + '-color']);
            gl.uniform1f(shader.u_buffer, (256 - 64) / 256);
            gl.drawArrays(gl.TRIANGLES, begin, len);

            if (layerStyle[prefix + '-halo-color']) {
                // Draw halo underneath the text.
                gl.uniform1f(shader.u_gamma, layerStyle[prefix + '-halo-blur'] * blurOffset / fontScale / sdfPx + gamma);
                gl.uniform4fv(shader.u_color, layerStyle[prefix + '-halo-color']);
                gl.uniform1f(shader.u_buffer, (haloOffset - layerStyle[prefix + '-halo-width'] / fontScale) / sdfPx);
                gl.drawArrays(gl.TRIANGLES, begin, len);
            }
        } else {
            gl.uniform1f(shader.u_opacity, layerStyle['icon-opacity']);
            gl.drawArrays(gl.TRIANGLES, begin, len);
        }
    });
}
