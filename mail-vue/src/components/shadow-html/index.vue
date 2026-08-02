<template>
  <iframe class="content-html" :srcdoc="documentHtml" sandbox referrerpolicy="no-referrer" title="Email content"></iframe>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  html: {
    type: String,
    required: true
  }
});

const documentHtml = computed(() => `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline'; base-uri 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"><style>
html, body { margin: 0; min-width: 100%; color: #13181D; font-family: -apple-system, Inter, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
body { background: #FFFFFF; }
img:not(table img) { max-width: 100%; height: auto !important; }
a { color: #0E70DF; text-decoration: none; }
h1, h2, h3, h4 { font-size: 18px; font-weight: 700; }
</style></head><body>${props.html}</body></html>`);
</script>

<style scoped>
.content-box {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: -apple-system, Inter, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
}

.content-html {
  width: 100%;
  height: 100%;
}
</style>
