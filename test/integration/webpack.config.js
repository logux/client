var HtmlWebpackPlugin = require('html-webpack-plugin')
var path = require('path')
var TARGET = process.env.npm_lifecycle_event

module.exports = {
  entry: path.resolve(__dirname, 'src/index.js'),
  output: {
    path: __dirname,
    publicPath: '/',
    filename: 'bundle.js'
  },
  module: {
    loaders: [
      { test: /\.(png|svg)$/, loader: 'url-loader' }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/index.html'),
      filename: 'index.html',
      inject: TARGET === 'demo'
    })
  ]
}
