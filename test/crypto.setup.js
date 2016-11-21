window.crypto = {
  getRandomValues: function (array) {
    for (var i = 0, r; i < 16; i++) {
      if ((i & 0x03) === 0) { r = Math.random() * 0x100000000 }
      array[i] = r >>> ((i & 0x03) << 3) & 0xff
    }
  }
}
