import {
  createRootRoute,
  type ErrorComponentProps,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import * as React from "react";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import appCss from "@/styles/app.css?url";
import { ThemeInitScript } from "@/components/theme-init-script";
import { ThemeProvider } from "@/components/theme-provider";
import { getTheme, type Theme } from "@/lib/theme";
import { DefaultCatchBoundary } from "@/components/DefaultCatchBoundary";
import { NotFound } from "@/components/NotFound";

const DOCS_TITLE = "Clawlets Docs";
const DOCS_DESCRIPTION = "Documentation for Clawlets.";
const DOCS_OG_IMAGE_PATH = "/og.png";

export const Route = createRootRoute({
  loader: () => getTheme(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: DOCS_TITLE },
      { name: "description", content: DOCS_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:title", content: DOCS_TITLE },
      { property: "og:description", content: DOCS_DESCRIPTION },
      { property: "og:image", content: DOCS_OG_IMAGE_PATH },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: DOCS_TITLE },
      { name: "twitter:description", content: DOCS_DESCRIPTION },
      { name: "twitter:image", content: DOCS_OG_IMAGE_PATH },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/logo.png" },
      { rel: "apple-touch-icon", href: "/logo.png" },
    ],
  }),
  errorComponent: (props: ErrorComponentProps) => (
    <RootDocument>
      <DefaultCatchBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: () => <NotFound />,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const initial = Route.useLoaderData() as Theme;
  return (
    <html
      lang="en"
      className={initial === "system" ? "" : initial}
      suppressHydrationWarning
    >
      <head>
        <ThemeInitScript />
        <HeadContent />
      </head>
      <body className="flex min-h-screen flex-col">
        <ThemeProvider initial={initial}>
          <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
