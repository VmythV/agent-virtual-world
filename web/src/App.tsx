import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import WorldView from "./WorldView";
import AdminConsole from "./admin/AdminConsole";
import AgentsTab from "./admin/AgentsTab";
import LaunchWorldTab from "./admin/LaunchWorldTab";
import "./App.css";

function App() {
  return (
    <div className="app-shell">
      <nav className="top-nav">
        <span className="top-nav-title">Agent Virtual World</span>
        <div className="top-nav-links">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            世界视图
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
            管理控制台
          </NavLink>
        </div>
      </nav>
      <div className="app-body">
        <Routes>
          <Route path="/" element={<WorldView />} />
          <Route path="/world/:worldId" element={<WorldView />} />
          <Route path="/admin" element={<AdminConsole />}>
            <Route index element={<Navigate to="agents" replace />} />
            <Route path="agents" element={<AgentsTab />} />
            <Route path="worlds/new" element={<LaunchWorldTab />} />
          </Route>
        </Routes>
      </div>
    </div>
  );
}

export default App;
