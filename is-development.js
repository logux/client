module.exports = function isDevelopment (url) {
  return (
    /^wss?:\/\/localhost/.test(url) ||
    /^wss?:\/\/127\.0\.0\.1/.test(url) ||
    /^wss?:\/\/ip6-localhost/.test(url) ||
    /^wss?:\/\/::1/.test(url) ||
    /^wss?:\/\/[^/\s:]+\.dev(\/|:|$)/.test(url) ||
    /^wss?:\/\/[^/\s:]+\.local(\/|:|$)/.test(url) ||
    /^wss?:\/\/169\.254\.\d+\.\d+/.test(url)
  )
}
