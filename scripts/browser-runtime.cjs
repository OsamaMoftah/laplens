// Keep static WASM imports visible to webpack; resolve other URLs in the browser.
module.exports = function browserRuntime(source) {
  return source.replace(
    /new URL\((["'])[^"']+\.wasm\1,\s*import\.meta\.url\)|import\.meta\.url/g,
    (expression) =>
      expression.startsWith("new URL(") ? expression : "self.location.href",
  );
};
