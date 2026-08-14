export const NSX_SETTINGS_KEY = "nsx_settings_v1"

export type NsXSettings = {
  loggedIn: boolean
  userEmail?: string
  userName?: string
  userAvatar?: string
  selectedWorkspaceId?: string
  selectedWorkspaceRole?: "owner" | "editor" | "viewer"
  annotationMode: "highlight" | "line" | "box"
}

export const getSettings = async (): Promise<NsXSettings> => {
  const res = await chrome.storage.local.get(NSX_SETTINGS_KEY)
  const raw = res?.[NSX_SETTINGS_KEY]
  const base: NsXSettings = {
    loggedIn: false,
    userEmail: undefined,
    userName: undefined,
    userAvatar: undefined,
    selectedWorkspaceId: undefined,
    selectedWorkspaceRole: undefined,
    annotationMode: "highlight"
  }
  if (!raw || typeof raw !== "object") return base
  const r = raw as Partial<NsXSettings>
  return {
    loggedIn: typeof r.loggedIn === "boolean" ? r.loggedIn : base.loggedIn,
    userEmail: typeof r.userEmail === "string" ? r.userEmail : base.userEmail,
    userName: typeof r.userName === "string" ? r.userName : base.userName,
    userAvatar: typeof r.userAvatar === "string" ? r.userAvatar : base.userAvatar,
    selectedWorkspaceId: typeof r.selectedWorkspaceId === "string" ? r.selectedWorkspaceId : undefined,
    selectedWorkspaceRole: ["owner", "editor", "viewer"].includes(r.selectedWorkspaceRole as string)
      ? r.selectedWorkspaceRole as NsXSettings["selectedWorkspaceRole"]
      : undefined,
    annotationMode:
      (r.annotationMode as string) === "line" || (r.annotationMode as string) === "underline"
        ? "line"
        : base.annotationMode
  }
}

export const setSettings = async (next: NsXSettings): Promise<void> => {
  await chrome.storage.local.set({
    [NSX_SETTINGS_KEY]: next
  })
}

export const patchSettings = async (
  patch: Partial<NsXSettings>
): Promise<NsXSettings> => {
  const cur = await getSettings()
  const next: NsXSettings = { ...cur, ...patch }
  await setSettings(next)
  return next
}
