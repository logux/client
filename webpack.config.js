var Analyzer = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
var webpack = require('webpack')

module.exports = {
  plugins: [
    new webpack.optimize.UglifyJsPlugin({ minimize: true }),
    new Analyzer({
      analyzerMode: 'static',
      reportFilename: 'bundle-report.html',
      openAnalyzer: false
    })
  ]
}
