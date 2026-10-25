// Resolve runtime assets from the browser worker, without embedding build-machine paths.
module.exports = function browserRuntime(source) {
  return source.replaceAll("import.meta.url", "self.location.href");
};
