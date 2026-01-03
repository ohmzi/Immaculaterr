import { motion } from 'motion/react';
import { ArrowLeft, Home } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <section className="relative min-h-[calc(100vh-160px)] overflow-hidden">
      {/* Background (match landing page) */}
      <div className="pointer-events-none fixed inset-0">
        <img
          src="https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb3ZpZSUyMHBvc3RlcnMlMjB3YWxsJTIwZGlhZ29uYWx8ZW58MXx8fHwxNzY3MzY5MDYwfDA&ixlib=rb-4.1.0&q=80&w=1920&utm_source=figma&utm_medium=referral"
          alt="Movie posters collection"
          className="h-full w-full object-cover object-center"
        />
      </div>

      {/* Red tint overlay */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-red-600/85 via-rose-500/80 to-orange-400/75" />
      <div className="pointer-events-none fixed inset-0 bg-black/10" />

      {/* Content */}
      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-160px)] max-w-6xl items-center justify-center px-6 py-10">
        <motion.div
          initial={{ opacity: 0, y: 14, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="w-full max-w-2xl"
        >
          <div className="w-full rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl border border-white/10 bg-gradient-to-br from-gray-900/85 to-gray-800/65">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h1 className="text-3xl sm:text-4xl font-bold text-white">
                  Page not found
                </h1>
                <p className="mt-3 text-sm sm:text-base text-white/70">
                  The page you requested doesn’t exist or was moved.
                </p>
              </div>
            </div>

            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <Button
                variant="outline"
                onClick={() => navigate(-1)}
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                <ArrowLeft />
                Back
              </Button>
              <Button asChild className="bg-white text-gray-900 hover:bg-white/90">
                <Link to="/">
                  <Home />
                  Go home
                </Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}


