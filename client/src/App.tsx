import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Demo from "./pages/Demo";
import KnowledgeBase from "./pages/KnowledgeBase";
import Architecture from "./pages/Architecture";
import CostLog from "./pages/CostLog";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/crm"}>
        <DashboardLayout>
          <Demo />
        </DashboardLayout>
      </Route>
      <Route path={"/demo"}>
        <DashboardLayout>
          <Demo />
        </DashboardLayout>
      </Route>
      <Route path={"/knowledge"}>
        <DashboardLayout>
          <KnowledgeBase />
        </DashboardLayout>
      </Route>
      <Route path={"/architecture"}>
        <DashboardLayout>
          <Architecture />
        </DashboardLayout>
      </Route>
      <Route path={"/cost-log"}>
        <DashboardLayout>
          <CostLog />
        </DashboardLayout>
      </Route>
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
