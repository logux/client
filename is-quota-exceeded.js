module.exports = function isQuotaExceeded (e) {
  if (e.code === DOMException.QUOTA_EXCEEDED_ERR) {
    // Standard
    return true
  } else if (e.code === 1014 && e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    // Firefox
    return true
  } else {
    return false
  }
}
