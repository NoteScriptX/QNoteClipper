import { getValidAccessToken, QTABLE_API_BASE_URL } from "./auth"

export type QTable = {
  id: string
  name: string
  emoji?: string
  row_count: number
}

export type QTableUser = {
  id: number
  name: string
  email: string
}

/**
 * Helper function to make authenticated API requests
 */
async function authenticatedFetch(
  url: string,
  options: RequestInit = {},
  retryCount = 0
): Promise<Response> {
  const token = await getValidAccessToken()
  
  if (!token) {
    throw new Error("Not authenticated. Please log in.")
  }

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  }

  const response = await fetch(url, {
    ...options,
    headers
  })

  // Handle 401 - token might be expired
  if (response.status === 401 && retryCount === 0) {
    // Force token refresh by clearing cached state
    const newToken = await getValidAccessToken()
    if (newToken && newToken !== token) {
      // Retry with new token
      headers.Authorization = `Bearer ${newToken}`
      return await fetch(url, {
        ...options,
        headers
      })
    }
  }

  return response
}

export const getQtables = async (): Promise<QTable[]> => {
  const response = await authenticatedFetch(`${QTABLE_API_BASE_URL}/api/clipper/tables`)
  if (!response.ok) throw new Error("加载 QTable 表格失败")
  return (await response.json()) as QTable[]
}

export const getQtableUsers = async (): Promise<QTableUser[]> => {
  const response = await authenticatedFetch(`${QTABLE_API_BASE_URL}/api/clipper/users`)
  if (!response.ok) throw new Error("加载 QTable 用户失败")
  return (await response.json()) as QTableUser[]
}

export type ApiError = {
  error: string
  message: string
}

export type CreateTaskFromAnnotationInput = {
  annotationId: string
  task: {
    title: string
    assignee_email?: string
    due_date?: string
    target_table_id: string
    include_context_url?: boolean
    note?: string
    selected_text?: string
    page_url?: string
    page_title?: string
    mode?: "highlight" | "line" | "box" | "underline"
  }
}

export type CreateTaskFromAnnotationResponse = {
  task_id: string
  qtable_url: string
  annotation_status: "task_created"
}

type StoredTask = {
  task_id: string
  annotation_id: string
  title: string
  assignee_email: string
  due_date?: string
  target_table_id: string
  include_context_url: boolean
  created_at: string
  qtable_url: string
}

const delay = async <T>(value: T, ms: number): Promise<T> =>
  await new Promise((resolve) => setTimeout(() => resolve(value), ms))

const tasksKey = "nsx_mock_tasks_v2"

const readTasks = (): StoredTask[] => {
  try {
    const raw = localStorage.getItem(tasksKey)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as StoredTask[]) : []
  } catch {
    return []
  }
}

const writeTasks = (tasks: StoredTask[]) => {
  localStorage.setItem(tasksKey, JSON.stringify(tasks))
}

const genTaskId = (tasks: StoredTask[]) => {
  const n = tasks.length + 1
  return `task_${String(n).padStart(4, "0")}`
}

const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export const createTaskFromAnnotation = async (
  input: CreateTaskFromAnnotationInput
): Promise<CreateTaskFromAnnotationResponse> => {
  // Validation (keep existing validation logic)
  const title = input.task.title.trim()
  if (title.length < 1 || title.length > 200) {
    throw {
      error: "invalid_title",
      message: "任务标题长度需为 1-200 字符。"
    } satisfies ApiError
  }

  const assigneeEmail = (input.task.assignee_email ?? "").trim()

  const dueDate = input.task.due_date?.trim()
  if (dueDate && !isValidDate(dueDate)) {
    throw {
      error: "invalid_due_date",
      message: "截止日期格式应为 YYYY-MM-DD。"
    } satisfies ApiError
  }

  const tableId = input.task.target_table_id.trim()
  if (!tableId) {
    throw {
      error: "invalid_target_table_id",
      message: "请选择目标表格。"
    } satisfies ApiError
  }

  const includeContextUrl = input.task.include_context_url !== false

  const response = await authenticatedFetch(`${QTABLE_API_BASE_URL}/api/clipper/tasks`, {
    method: "POST",
    body: JSON.stringify({
      annotation_id: input.annotationId,
      title,
      note: input.task.note ?? "",
      selected_text: input.task.selected_text ?? "",
      page_url: input.task.page_url ?? "",
      page_title: input.task.page_title ?? "",
      mode: input.task.mode ?? "highlight",
      target_table_id: tableId,
      assignee_email: assigneeEmail || undefined,
      due_date: dueDate || undefined,
      include_context_url: includeContextUrl
    })
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.detail || "创建 QTable 任务失败")
  }
  return (await response.json()) as CreateTaskFromAnnotationResponse
  
  // Uncomment when API is ready:
  // const response = await authenticatedFetch(
  //   'https://qtable.example.com/api/annotations/' + input.annotationId + '/tasks',
  //   {
  //     method: 'POST',
  //     body: JSON.stringify(input.task)
  //   }
  // )
  // if (!response.ok) {
  //   const errorData = await response.json()
  //   throw errorData
  // }
  // return await response.json()
}

export type UserMe = {
  id: string
  name: string
  email: string
  avatar_url: string
}

export const getUserMe = async (): Promise<UserMe> => {
  const response = await authenticatedFetch(`${QTABLE_API_BASE_URL}/oauth/me`)
  if (!response.ok) throw new Error("获取用户信息失败")
  return (await response.json()) as UserMe
}

export type AnnotationTaskDTO = {
  id: string
  status: "open"
  assignee_email: string
  due_date?: string
}

export type AnnotationDTO = {
  id: string
  page_url: string
  page_title: string
  selected_text: string
  note: string
  created_at: string
  task: AnnotationTaskDTO | null
}

export const getAnnotation = async (input: {
  annotationId: string
  local?: {
    url: string
    pageTitle: string
    selectedText: string
    note: string
    createdAt: number
    task?: { taskId: string }
  }
}): Promise<AnnotationDTO> => {
  const a = input.local
  if (!a) {
    throw { error: "not_found", message: "批注不存在。" } satisfies ApiError
  }
  const tasks = readTasks()
  const t = a.task?.taskId
    ? tasks.find((x) => x.task_id === a.task?.taskId)
    : undefined

  return await delay(
    {
      id: input.annotationId,
      page_url: a.url,
      page_title: a.pageTitle,
      selected_text: a.selectedText,
      note: a.note,
      created_at: new Date(a.createdAt).toISOString(),
      task: t
        ? {
            id: t.task_id,
            status: "open",
            assignee_email: t.assignee_email,
            due_date: t.due_date
          }
        : null
    },
    140
  )
}
