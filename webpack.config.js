const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

const serverConfig = {
    devtool: false,
    target: 'node',
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'plugin.js',
        libraryTarget: 'commonjs',
        libraryExport: 'default',
    },
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            punycode: 'punycode2',
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    optimization: {
        minimizer: [
            new TerserPlugin({
                extractComments: false,
                terserOptions: {
                    format: {
                        comments: false,
                    },
                },
            }),
        ],
    },
    externals: [
        {
            punycode: {
                commonjs: 'punycode2',
                commonjs2: 'punycode2',
            },
        },
    ],
    plugins: [
        new webpack.IgnorePlugin({
            resourceRegExp: /canvas/,
            contextRegExp: /jsdom$/,
        }),
    ],
};

module.exports = [serverConfig];
