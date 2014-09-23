'use strict';

var browser = require('../util/browser');

module.exports = function drawLine(painter, layer, layerStyle, tiles) {
    var gl = painter.gl;
    var sprite = painter.sprite;

    var width = layerStyle['line-width'];
    if (width <= 0)
        return;

    var image = layerStyle['line-image'];
    if (image && (!sprite || !sprite.loaded()))
        return;

    var shader, imagePos;
    if (image) {
        painter.sprite.bind(gl, true);

        shader = painter.linepatternShader;
        gl.switchShader(shader);

        imagePos = sprite.getPosition(image);
        gl.uniform2fv(shader.u_pattern_tl, imagePos.tl);
        gl.uniform2fv(shader.u_pattern_br, imagePos.br);
        gl.uniform1f(shader.u_fade, painter.transform.zoomFraction);

    } else {
        shader = painter.lineShader;
        gl.switchShader(shader);

        gl.uniform4fv(shader.u_color, layerStyle['line-color']);
        gl.uniform2fv(shader.u_dasharray, layerStyle['line-dasharray']);
    }

    var antialiasing = 1 / browser.devicePixelRatio;
    var blur = layerStyle['line-blur'] + antialiasing;
    var offset = layerStyle['line-gap-width'] > 0 ? layerStyle['line-gap-width'] / 2 + width / 2 : 0;
    var outset = offset + width / 2 + antialiasing / 2;
    var inset = Math.max(-1, offset - width / 2 - antialiasing / 2) + 1;

    gl.uniform2fv(shader.u_linewidth, [outset, inset]);
    gl.uniform1f(shader.u_blur, blur);

    tiles.forEach(function (tile) {
        var bucket = tile.buckets[layer.ref || layer.id];
        if (!bucket)
            return;

        painter.drawClippingMask(tile.posMatrix);
        gl.switchShader(shader);

        var posMatrix = painter.translateMatrix(tile.posMatrix, tile.zoom,
            layerStyle['line-translate'], layerStyle['line-translate-anchor']);

        var vertex = bucket.buffers.lineVertex;
        vertex.bind(gl);
        var element = bucket.buffers.lineElement;
        element.bind(gl);

        gl.uniformMatrix4fv(shader.u_matrix, false, posMatrix);
        gl.uniformMatrix4fv(shader.u_exmatrix, false, tile.exMatrix);

        gl.uniform1f(shader.u_ratio, painter.transform.scale / (1 << tile.zoom) / 8);

        if (imagePos) {
            var factor = 8 / Math.pow(2, painter.transform.tileZoom - tile.zoom);
            gl.uniform2fv(shader.u_pattern_size, [imagePos.size[0] * factor, imagePos.size[1]]);
        }

        var groups = bucket.elementGroups.groups;
        for (var i = 0; i < groups.length; i++) {
            var group = groups[i];
            var vtxOffset = group.vertexStartIndex * vertex.itemSize;
            gl.vertexAttribPointer(shader.a_pos, 4, gl.SHORT, false, 8, vtxOffset + 0);
            gl.vertexAttribPointer(shader.a_extrude, 2, gl.BYTE, false, 8, vtxOffset + 6);
            gl.vertexAttribPointer(shader.a_linesofar, 2, gl.SHORT, false, 8, vtxOffset + 4);

            var count = group.elementLength * 3;
            var elementOffset = group.elementStartIndex * element.itemSize;
            gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, elementOffset);
        }
    });
};
