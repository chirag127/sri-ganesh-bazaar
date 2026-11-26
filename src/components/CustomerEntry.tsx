import AppErrorBoundary from './AppErrorBoundary';
import CustomerApp from './CustomerApp';

export default function CustomerEntry() {
  return <AppErrorBoundary><CustomerApp /></AppErrorBoundary>;
}
