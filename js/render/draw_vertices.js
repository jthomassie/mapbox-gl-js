'use strict';

var browser = require('../util/browser');
var mat4 = require('gl-matrix').mat4;

module.exports = drawVertices;

function drawVertices(painter, layer, tiles) {
    var gl = painter.gl;

    // Blend to the front, not the back.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.switchShader(painter.dotShader);

    // // Draw debug points.
    gl.uniform1f(painter.dotShader.u_size, 4 * browser.devicePixelRatio);
    gl.uniform1f(painter.dotShader.u_blur, 0.25);
    gl.uniform4fv(painter.dotShader.u_color, [0.25, 0, 0, 0.25]);

    tiles.forEach(function(tile) {
        var bucket = tile.buckets[layer.ref || layer.id];
        if (!bucket)
            return;

        gl.uniformMatrix4fv(painter.dotShader.u_matrix, false, tile.posMatrix);
        gl.uniformMatrix4fv(painter.dotShader.u_exmatrix, false, tile.exMatrix);

        // Draw the actual triangle fan into the stencil buffer.

        var vertex, groups, group, begin, count;

        // Draw all buffers
        if (bucket.layoutProperties.fill) {
            vertex = bucket.buffers.fillVertex;
            vertex.bind(gl);
            groups = bucket.elementGroups.groups;
            for (var i = 0; i < groups.length; i++) {
                group = groups[i];
                begin = group.vertexStartIndex;
                count = group.vertexLength;
                gl.vertexAttribPointer(painter.dotShader.a_pos, 2, gl.SHORT, false, 0, 0);
                gl.drawArrays(gl.POINTS, begin, count);
            }
        }

        var newPosMatrix = mat4.clone(tile.posMatrix);
        mat4.scale(newPosMatrix, newPosMatrix, [0.5, 0.5, 1]);
        gl.uniformMatrix4fv(painter.dotShader.u_matrix, false, newPosMatrix);

        // Draw all line buffers
        if (bucket.layoutProperties.line) {
            vertex = bucket.buffers.lineVertex;
            vertex.bind(gl);
            groups = bucket.elementGroups.groups;
            for (var k = 0; k < groups.length; k++) {
                group = groups[k];
                begin = group.vertexStartIndex;
                count = group.vertexLength;
                gl.vertexAttribPointer(painter.dotShader.a_pos, 2, gl.SHORT, false, 0, 0);
                gl.drawArrays(gl.POINTS, begin, count);
            }
        }
    });

    // Revert blending mode to blend to the back.
    gl.blendFunc(gl.ONE_MINUS_DST_ALPHA, gl.ONE);
}
