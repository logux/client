module.exports = function isDevelopment (url) {
  return (
    /^wss?:\/\/localhost/.test(url) ||
    /^wss?:\/\/127(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}/.test(url) ||
    /^wss?:\/\/ip6-localhost/.test(url) ||
    /^wss?:\/\/::1/.test(url) ||
    /^wss?:\/\/[^/\s:]+\.dev(\/|:|$)/.test(url) ||
    /^wss?:\/\/[^/\s:]+\.local(\/|:|$)/.test(url)
  )
}
