import { MobileNavigation } from '@/components/MobileNavigation';
import { Navigation } from '@/components/Navigation';
import { HeroSection } from '@/components/HeroSection';

export function DashboardPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="lg:hidden">
        <MobileNavigation />
      </div>
      <HeroSection />
    </div>
  );
}
