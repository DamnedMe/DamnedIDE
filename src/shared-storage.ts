// Every localStorage write also reaches the copy shared by all IDE instances
// (electron/services/storage/shared-storage.ts): one hook for every caller.
// Imported first by main.tsx, before any store writes.
const setItem = Storage.prototype.setItem
const removeItem = Storage.prototype.removeItem

function mirror(storage: Storage, key: string, value: string | null): void {
  if (storage === window.localStorage) window.electronAPI?.storage?.set(key, value)
}

Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
  setItem.call(this, key, value)
  mirror(this, key, String(value))
}

Storage.prototype.removeItem = function (this: Storage, key: string) {
  removeItem.call(this, key)
  mirror(this, key, null)
}

export {}
