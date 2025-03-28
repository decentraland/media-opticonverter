import { Router } from "@well-known-components/http-server"
import { GlobalContext } from "../types"
import { pingHandler } from "./handlers/ping-handler"
import { convertHandler } from "./handlers/convert-handler"
import { storageHandler } from "./handlers/storage-handler"

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(globalContext: GlobalContext): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  router.get("/ping", pingHandler)
  router.get("/convert", convertHandler)
  router.post("/convert", convertHandler)

  // Add storage route for local files only when USE_LOCAL_STORAGE is true
  const useLocalStorage = await globalContext.components.config.getString('USE_LOCAL_STORAGE') === 'true'
  if (useLocalStorage) {
    router.get('/storage/:filename', storageHandler)
  }

  return router
}
