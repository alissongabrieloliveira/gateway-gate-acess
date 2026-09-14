function timestamp() {
  return new Date().toISOString();
}

module.exports = {
  info: (...args) => console.log(`[${timestamp()}]`, ...args),
  warn: (...args) => console.warn(`[${timestamp()}]`, ...args),
  error: (...args) => console.error(`[${timestamp()}]`, ...args),
};
