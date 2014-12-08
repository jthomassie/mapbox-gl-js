module.exports = function(config) {
    'use strict';
    config.set({
        frameworks: ['browserify', 'tap'],
        files: [
            'test/js/**/*.js'
        ],
        preprocessors: {
            'test/js/**/*.js': [ 'browserify' ]
        },
        browserify: {
          debug: true,
          transform: ['envify', '6to5-browserify']
        },
        browsers: ['Chrome', 'Firefox', 'Safari'],
        autoWatch: true
    });
};
