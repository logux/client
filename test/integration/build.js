var fs = require('fs')
var path = require('path')
var MemoryFS = require('memory-fs')
var webpack = require('webpack')
var options = require('./webpack.config')

var memoryFs = new MemoryFS()
var compiler = webpack(options)
compiler.outputFileSystem = memoryFs
compiler.run(function (compilerError) {
  if (compilerError) {
    console.log(compilerError)
  } else {
    var bundlePath = path.resolve(options.output.path, options.output.filename)
    var htmlPath = path.resolve(options.output.path, 'index.html')

    var bundleContent = memoryFs.readFileSync(bundlePath, 'utf8')
    var htmlContent = memoryFs.readFileSync(htmlPath, 'utf8')

    var output = htmlContent.replace('</body>',
      '<script>' + bundleContent + '</script></body>')

    fs.writeFile(htmlPath, output, function (fsError) {
      if (fsError) {
        console.log(fsError)
      } else {
        console.log('The file was saved!')
      }
    })
  }
})
