<script setup>
import GalleryView from './gallery/GalleryView.vue'
import MenuView from './menu/MenuView.vue'

// 動作展示館是開發工具，主選單不顯示：網址加 ?gallery 才進得去
const isGallery = new URLSearchParams(window.location.search).has('gallery')
</script>

<template>
  <GalleryView v-if="isGallery" />
  <MenuView v-else />
</template>

<style>
html,
body,
#app {
  margin: 0;
  height: 100%;
}

.stage {
  position: fixed;
  inset: 0;
  overflow: hidden;
}

.status {
  position: fixed;
  top: 16px;
  left: 16px;
  margin: 0;
  padding: 6px 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  color: #4a3326;
  font: 14px sans-serif;
}
</style>
