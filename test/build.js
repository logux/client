#!/usr/bin/env node

let { join } = require('path')
let Bundler = require('parcel-bundler')
let ciJobNumber = require('ci-job-number')

if (ciJobNumber() > 1) {
  process.stdout.write('Avoid building demo website to keep CI resources\n')
  process.exit(0)
}

async function build () {
  let bundler = new Bundler(join(__dirname, '../test/demo/index.html'), {
    outDir: join(__dirname, '../test/demo/build'),
    cacheDir: join(__dirname, '../test/demo/.cache'),
    sourceMaps: false
  })
  await bundler.bundle()
}

build().catch(e => {
  process.stderr.write(e.stack + '\n')
  process.exit(1)
})
