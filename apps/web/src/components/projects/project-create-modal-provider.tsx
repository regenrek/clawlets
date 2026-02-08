import { useRouterState } from "@tanstack/react-router"
import * as React from "react"
import { ProjectCreateDialog } from "~/components/projects/project-create-dialog"

type ProjectCreateModalContextValue = {
  openProjectCreateModal: () => void
  closeProjectCreateModal: () => void
}

const ProjectCreateModalContext = React.createContext<ProjectCreateModalContextValue | null>(null)

function ProjectCreateModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  React.useEffect(() => {
    setOpen(false)
  }, [pathname])

  const value = React.useMemo<ProjectCreateModalContextValue>(() => ({
    openProjectCreateModal: () => setOpen(true),
    closeProjectCreateModal: () => setOpen(false),
  }), [])

  return (
    <ProjectCreateModalContext.Provider value={value}>
      {children}
      <ProjectCreateDialog open={open} onOpenChange={setOpen} />
    </ProjectCreateModalContext.Provider>
  )
}

function useProjectCreateModal(): ProjectCreateModalContextValue {
  const context = React.useContext(ProjectCreateModalContext)
  if (!context) {
    throw new Error("useProjectCreateModal must be used within a ProjectCreateModalProvider")
  }
  return context
}

export { ProjectCreateModalProvider, useProjectCreateModal }
