var Analyzer = require('webpack-bundle-analyzer').BundleAnalyzerPlugin

module.exports = {
  module: {
    loaders: [
      { test: /\.json$/, loader: 'json-loader' }
    ]
  },
  plugins: [new Analyzer({
    analyzerMode: 'static',
    reportFilename: 'bundle-report.html',
    openAnalyzer: false
  })]
}
