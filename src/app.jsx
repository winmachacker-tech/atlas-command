import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./layout/MainLayout";
import Dashboard from "./pages/Dashboard";
import Loads from "./pages/Loads";
import ActivityFeed from "./pages/ActivityFeed";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import UsersPage from "./pages/Users"; // <-- Capital U, default export

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route element={<MainLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/loads" element={<Loads />} />
          <Route path="/activity" element={<ActivityFeed />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/users" element={<UsersPage />} /> {/* <-- here */}
        </Route>
        {/* temporary smoke test */}
        <Route path="/test" element={<div style={{padding:24}}>Test works</div>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
