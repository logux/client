var HtmlWebpackPlugin = require('html-webpack-plugin')
var path = require('path')

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  entry: path.join(__dirname, 'index.js'),
  output: {
    path: path.join(__dirname, 'build'),
    publicPath: './',
    filename: 'index.js'
  },
  module: {
    rules: [
      { test: /\.(png|svg)$/, use: 'url-loader' }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'index.html'),
      filename: 'index.html',
      minify: {
        collapseWhitespace: true,
        minifyCSS: true
      }
    })
  ],
  devServer: {
    contentBase: path.join(__dirname, 'build'),
    open: true
  }
}
