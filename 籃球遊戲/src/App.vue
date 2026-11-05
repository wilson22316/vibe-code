<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { createGallery } from './gallery/scene.js'

const stage = ref(null)
const status = ref('模型載入中…')
let gallery = null

onMounted(() => {
  gallery = createGallery(stage.value)
  gallery.ready.then(
    () => (status.value = ''),
    (err) => {
      status.value = `模型載入失敗：${err.message ?? err}`
      console.error(err)
    },
  )
})

onBeforeUnmount(() => {
  gallery?.dispose()
})
</script>

<template>
  <div ref="stage" class="stage"></div>
  <p v-if="status" class="status">{{ status }}</p>
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
