import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/AppLayout.jsx';
import { ToastProvider } from './components/ToastProvider.jsx';
import { AuthProvider, PERMISSIONS, useAuth } from './auth/AuthProvider.jsx';
import { RequireAuth, RequirePermission } from './auth/RequireAuth.jsx';
import { Login } from './pages/Login.jsx';
import { UserManagement } from './pages/UserManagement.jsx';
import { Employees } from './pages/Employees.jsx';
import { EmployeeForm } from './pages/EmployeeForm.jsx';
import { Departments } from './pages/Departments.jsx';
import { JobPositions } from './pages/JobPositions.jsx';
import { Contracts } from './pages/Contracts.jsx';
import { ContractForm } from './pages/ContractForm.jsx';
import { Attendance } from './pages/Attendance.jsx';
import { AttendanceForm } from './pages/AttendanceForm.jsx';
import { TimeOffRequests } from './pages/TimeOffRequests.jsx';
import { TimeOffRequestForm } from './pages/TimeOffRequestForm.jsx';
import { Allocations } from './pages/Allocations.jsx';
import { AllocationForm } from './pages/AllocationForm.jsx';
import { TimeOffTypes } from './pages/TimeOffTypes.jsx';
import { SalaryStructures } from './pages/SalaryStructures.jsx';
import { StructureForm } from './pages/StructureForm.jsx';
import { SalaryRules } from './pages/SalaryRules.jsx';
import { RuleForm } from './pages/RuleForm.jsx';
import { Payruns } from './pages/Payruns.jsx';
import { PayrunForm } from './pages/PayrunForm.jsx';
import { Payslips } from './pages/Payslips.jsx';
import { PayslipForm } from './pages/PayslipForm.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Schedules } from './pages/Schedules.jsx';
import { ScheduleForm } from './pages/ScheduleForm.jsx';
import { SystemStatus } from './pages/SystemStatus.jsx';
import { NotFound } from './pages/NotFound.jsx';

/**
 * Where "/" sends a user, in the order a role would expect.
 *
 * Roles do not all share a home screen: an HR manager belongs on the employee
 * list, a payroll user on the dashboard. Landing everyone on the dashboard
 * would drop the accounts that cannot open it onto a refusal page.
 */
const LANDING = [
  { permission: PERMISSIONS.DASHBOARD_READ, to: '/dashboard' },
  { permission: PERMISSIONS.EMPLOYEES_READ, to: '/employees' },
  { permission: PERMISSIONS.TIMEOFF_READ, to: '/time-off/requests' },
  { permission: PERMISSIONS.ATTENDANCE_READ, to: '/attendance' },
  { permission: PERMISSIONS.USERS_MANAGE, to: '/users' },
  // A self-service-only employee: their own attendance is the home screen,
  // not the refusal page the module permissions above would fall through to.
  { permission: PERMISSIONS.SELF_SERVICE, to: '/attendance' },
];

function Landing() {
  const { can } = useAuth();
  const target = LANDING.find((entry) => can(entry.permission));
  // An account with self service only has no module screen yet; the system
  // page is the one screen every signed-in user may open.
  return <Navigate to={target?.to ?? '/system'} replace />;
}

/**
 * Route table for the whole application.
 *
 * Routes are declared up front so navigation, deep links and the filtered views
 * opened by employee smart buttons all work against real URLs. Every route
 * below renders a real screen: the placeholder used during the build is gone,
 * which is the check that nothing was left unimplemented.
 *
 * Everything except /login sits behind RequireAuth: the application is reached
 * by signing in, never by typing an address.
 */
export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Landing />} />

            <Route
              path="/dashboard"
              element={
                <RequirePermission permission={PERMISSIONS.DASHBOARD_READ}>
                  <Dashboard />
                </RequirePermission>
              }
            />

            <Route
              path="/users"
              element={
                <RequirePermission permission={PERMISSIONS.USERS_MANAGE}>
                  <UserManagement />
                </RequirePermission>
              }
            />

            <Route
              path="/employees"
              element={
                <RequirePermission permission={PERMISSIONS.EMPLOYEES_READ}>
                  <Employees />
                </RequirePermission>
              }
            />
            <Route
              path="/employees/:id"
              element={
                <RequirePermission permission={PERMISSIONS.EMPLOYEES_READ}>
                  <EmployeeForm />
                </RequirePermission>
              }
            />
            <Route
              path="/departments"
              element={
                <RequirePermission permission={PERMISSIONS.EMPLOYEES_READ}>
                  <Departments />
                </RequirePermission>
              }
            />
            <Route
              path="/job-positions"
              element={
                <RequirePermission permission={PERMISSIONS.EMPLOYEES_READ}>
                  <JobPositions />
                </RequirePermission>
              }
            />
            <Route
              path="/contracts"
              element={
                <RequirePermission permission={PERMISSIONS.EMPLOYEES_READ}>
                  <Contracts />
                </RequirePermission>
              }
            />
            <Route
              path="/contracts/:id"
              element={
                <RequirePermission permission={PERMISSIONS.EMPLOYEES_READ}>
                  <ContractForm />
                </RequirePermission>
              }
            />
            <Route
              path="/schedules"
              element={
                <RequirePermission permission={PERMISSIONS.EMPLOYEES_READ}>
                  <Schedules />
                </RequirePermission>
              }
            />
            <Route
              path="/schedules/:id"
              element={
                <RequirePermission permission={PERMISSIONS.EMPLOYEES_READ}>
                  <ScheduleForm />
                </RequirePermission>
              }
            />

            <Route
              path="/attendance"
              element={
                <RequirePermission anyOf={[PERMISSIONS.ATTENDANCE_READ, PERMISSIONS.SELF_SERVICE]}>
                  <Attendance />
                </RequirePermission>
              }
            />
            <Route
              path="/attendance/:id"
              element={
                <RequirePermission anyOf={[PERMISSIONS.ATTENDANCE_READ, PERMISSIONS.SELF_SERVICE]}>
                  <AttendanceForm />
                </RequirePermission>
              }
            />

            <Route
              path="/time-off/requests"
              element={
                <RequirePermission anyOf={[PERMISSIONS.TIMEOFF_READ, PERMISSIONS.SELF_SERVICE]}>
                  <TimeOffRequests />
                </RequirePermission>
              }
            />
            <Route
              path="/time-off/requests/:id"
              element={
                <RequirePermission anyOf={[PERMISSIONS.TIMEOFF_READ, PERMISSIONS.SELF_SERVICE]}>
                  <TimeOffRequestForm />
                </RequirePermission>
              }
            />
            <Route
              path="/time-off/allocations"
              element={
                <RequirePermission anyOf={[PERMISSIONS.TIMEOFF_READ, PERMISSIONS.SELF_SERVICE]}>
                  <Allocations />
                </RequirePermission>
              }
            />
            <Route
              path="/time-off/allocations/:id"
              element={
                <RequirePermission anyOf={[PERMISSIONS.TIMEOFF_READ, PERMISSIONS.SELF_SERVICE]}>
                  <AllocationForm />
                </RequirePermission>
              }
            />
            <Route
              path="/time-off/types"
              element={
                <RequirePermission permission={PERMISSIONS.TIMEOFF_READ}>
                  <TimeOffTypes />
                </RequirePermission>
              }
            />

            <Route
              path="/payroll/structures"
              element={
                <RequirePermission permission={PERMISSIONS.PAYROLL_READ}>
                  <SalaryStructures />
                </RequirePermission>
              }
            />
            <Route
              path="/payroll/structures/:id"
              element={
                <RequirePermission permission={PERMISSIONS.PAYROLL_READ}>
                  <StructureForm />
                </RequirePermission>
              }
            />
            <Route
              path="/payroll/rules"
              element={
                <RequirePermission permission={PERMISSIONS.PAYROLL_READ}>
                  <SalaryRules />
                </RequirePermission>
              }
            />
            <Route
              path="/payroll/rules/:id"
              element={
                <RequirePermission permission={PERMISSIONS.PAYROLL_READ}>
                  <RuleForm />
                </RequirePermission>
              }
            />
            <Route
              path="/payroll/payruns"
              element={
                <RequirePermission permission={PERMISSIONS.PAYROLL_READ}>
                  <Payruns />
                </RequirePermission>
              }
            />
            <Route
              path="/payroll/payruns/:id"
              element={
                <RequirePermission permission={PERMISSIONS.PAYROLL_READ}>
                  <PayrunForm />
                </RequirePermission>
              }
            />
            <Route
              path="/payroll/payslips"
              element={
                <RequirePermission anyOf={[PERMISSIONS.PAYROLL_READ, PERMISSIONS.SELF_SERVICE]}>
                  <Payslips />
                </RequirePermission>
              }
            />
            <Route
              path="/payroll/payslips/:id"
              element={
                <RequirePermission anyOf={[PERMISSIONS.PAYROLL_READ, PERMISSIONS.SELF_SERVICE]}>
                  <PayslipForm />
                </RequirePermission>
              }
            />

            <Route path="/system" element={<SystemStatus />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </ToastProvider>
    </AuthProvider>
  );
}
