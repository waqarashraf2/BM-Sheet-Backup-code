import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import CommandPalette from '../ui/CommandPalette';
import MachineIdPromptModal from '../Auth/MachineIdPromptModal';

export default function Layout() {
  
  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50">
          <div className="max-w-[1440px] mx-auto px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
      
      {/* Command Palette */}
      <CommandPalette />

      {/* Machine ID prompt for users with empty machine_id */}
      <MachineIdPromptModal />
    </div>
  );
}
