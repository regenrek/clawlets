import { Link, useRouterState } from "@tanstack/react-router"
import * as React from "react"
import {
  ArrowPathIcon,
  ClockIcon,
  CloudArrowUpIcon,
  CodeBracketSquareIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  CpuChipIcon,
  ClipboardDocumentCheckIcon,
  DocumentTextIcon,
  FolderIcon,
  KeyIcon,
  PuzzlePieceIcon,
  RocketLaunchIcon,
  ServerStackIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
} from "~/components/ui/sidebar"
import { Button } from "~/components/ui/button"
import { cn } from "~/lib/utils"

type NavItem = {
  to: string
  label: string
  icon?: React.ComponentType<React.ComponentProps<"svg">>
}

function useActiveProjectId(): string | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const match = pathname.match(/^\/projects\/([^/]+)/)
  const raw = match?.[1] ?? null
  if (!raw) return null
  if (raw === "new" || raw === "import") return null
  return raw
}

function NavLink({
  item,
  isActive,
}: {
  item: NavItem
  isActive: boolean
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        render={
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to={item.to} />}
            className={cn(
              "w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive && "bg-sidebar-accent text-sidebar-accent-foreground"
            )}
          />
        }
      >
        {item.icon ? <item.icon aria-hidden="true" /> : null}
        <span className="truncate">{item.label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

function AppSidebarContent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const projectId = useActiveProjectId()

  const base: NavItem[] = [
    { to: "/projects", label: "Projects", icon: FolderIcon },
  ]

  const projectBase = projectId ? `/projects/${projectId}` : null
  const setup: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/setup/fleet`, label: "Fleet", icon: Cog6ToothIcon },
        { to: `${projectBase}/setup/hosts`, label: "Hosts", icon: ServerStackIcon },
        { to: `${projectBase}/setup/bots`, label: "Bots", icon: CpuChipIcon },
        { to: `${projectBase}/setup/providers`, label: "Providers", icon: PuzzlePieceIcon },
        { to: `${projectBase}/setup/secrets`, label: "Secrets", icon: KeyIcon },
        { to: `${projectBase}/setup/doctor`, label: "Doctor", icon: WrenchScrewdriverIcon },
        { to: `${projectBase}/setup/bootstrap`, label: "Bootstrap", icon: RocketLaunchIcon },
      ]
    : []

  const operate: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/operate/deploy`, label: "Deploy", icon: CloudArrowUpIcon },
        { to: `${projectBase}/operate/logs`, label: "Logs", icon: DocumentTextIcon },
        { to: `${projectBase}/operate/audit`, label: "Audit", icon: ClipboardDocumentCheckIcon },
        { to: `${projectBase}/operate/restart`, label: "Restart", icon: ArrowPathIcon },
      ]
    : []

  const advanced: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/advanced/editor`, label: "Raw Editor", icon: CodeBracketSquareIcon },
        { to: `${projectBase}/advanced/commands`, label: "Command Runner", icon: CommandLineIcon },
        { to: `${projectBase}/runs`, label: "Runs", icon: ClockIcon },
      ]
    : []

  return (
    <Sidebar variant="sidebar" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Home</SidebarGroupLabel>
          <SidebarMenu>
            {base.map((item) => (
              <NavLink key={item.to} item={item} isActive={pathname === item.to} />
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {projectId ? (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Setup</SidebarGroupLabel>
              <SidebarMenu>
                {setup.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Operate</SidebarGroupLabel>
              <SidebarMenu>
                {operate.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel>Advanced</SidebarGroupLabel>
              <SidebarMenu>
                {advanced.map((item) => (
                  <NavLink
                    key={item.to}
                    item={item}
                    isActive={pathname === item.to}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </>
        ) : null}
      </SidebarContent>
    </Sidebar>
  )
}

function AppSidebar({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <SidebarProvider>
      <AppSidebarContent />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}

export { AppSidebar }
