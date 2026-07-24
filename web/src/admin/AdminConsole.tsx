import { NavLink, Outlet } from "react-router-dom";

function AdminConsole() {
  return (
    <div className="admin">
      <nav className="admin-tabs">
        <NavLink to="/admin/agents" className={({ isActive }) => (isActive ? "active" : "")}>
          Agent 管理
        </NavLink>
        <NavLink to="/admin/worlds/new" className={({ isActive }) => (isActive ? "active" : "")}>
          发起世界
        </NavLink>
      </nav>
      <div className="admin-content">
        <Outlet />
      </div>
    </div>
  );
}

export default AdminConsole;
