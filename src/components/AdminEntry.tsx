import AppErrorBoundary from './AppErrorBoundary';
import AdminApp from './AdminApp';

export default function AdminEntry() {
  return <AppErrorBoundary><AdminApp /></AppErrorBoundary>;
}
