import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./ui/utils";
import { Button } from "./ui/button";

interface AnalogTimePickerProps {
  value: string; // "HH:MM" 24h format
  onChange: (value: string) => void;
  onClose?: () => void;
}

export function AnalogTimePicker({ value, onChange, onClose }: AnalogTimePickerProps) {
  // Parse initial value
  const [initialHours, initialMinutes] = value.split(':').map(Number);
  
  const [mode, setMode] = useState<'hours' | 'minutes'>('hours');
  const [hours, setHours] = useState(initialHours % 12 || 12);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [ampm, setAmpm] = useState<'AM' | 'PM'>(initialHours >= 12 ? 'PM' : 'AM');

  // Clock numbers
  const hourNumbers = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const minuteNumbers = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  const handleHourSelect = (h: number) => {
    setHours(h);
    setMode('minutes');
  };

  const handleMinuteSelect = (m: number) => {
    setMinutes(m);
  };
  const setModeHours = useCallback(() => {
    setMode('hours');
  }, []);
  const setModeMinutes = useCallback(() => {
    setMode('minutes');
  }, []);
  }, []);
  const setAm = useCallback(() => {
    setAmpm('AM');
  }, []);
  const setPm = useCallback(() => {
    setAmpm('PM');
  }, []);
  const handleHourButtonClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const raw = event.currentTarget.dataset.hour;
      const hour = Number.parseInt(raw ?? '', 10);
      if (!Number.isFinite(hour)) return;
      handleHourSelect(hour);
    },
    [],
  );
  const handleMinuteButtonClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const raw = event.currentTarget.dataset.minute;
      const minute = Number.parseInt(raw ?? '', 10);
      if (!Number.isFinite(minute)) return;
      handleMinuteSelect(minute);
    },
    [],
  );

  const handleSave = useCallback(() => {
    let finalHours = hours;
    if (ampm === 'PM' && hours !== 12) finalHours += 12;
    if (ampm === 'AM' && hours === 12) finalHours = 0;
    
    const formattedTime = `${String(finalHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    onChange(formattedTime);
    onClose?.();
  }, [ampm, hours, minutes, onChange, onClose]);

  // Calculate hand rotation
  const getRotation = () => {
    if (mode === 'hours') {
      return (hours % 12) * 30; // 360 / 12 = 30
    } else {
      return minutes * 6; // 360 / 60 = 6
    }
  };

  return (
    <div className="flex flex-col gap-4 p-2 w-[280px]">
      {/* Time Display Header */}
      <div className="flex items-center justify-center gap-2 p-4 bg-white/5 rounded-2xl border border-white/5">
        <button
          onClick={setModeHours}
          className={cn(
            "text-4xl font-bold transition-colors rounded px-2",
            mode === 'hours' ? "text-[#facc15] bg-white/5" : "text-white/50 hover:text-white"
          )}
        >
          {hours}
        </button>
        <span className="text-4xl font-bold text-white/30 pb-2">:</span>
        <button
          onClick={setModeMinutes}
          className={cn(
            "text-4xl font-bold transition-colors rounded px-2",
            mode === 'minutes' ? "text-[#facc15] bg-white/5" : "text-white/50 hover:text-white"
          )}
        >
          {String(minutes).padStart(2, '0')}
        </button>
        <div className="flex flex-col gap-1 ml-2">
          <button
            onClick={setAm}
            className={cn(
              "text-xs font-bold px-2 py-1 rounded transition-colors",
              ampm === 'AM' ? "bg-[#facc15] text-black" : "bg-white/5 text-gray-400 hover:text-white"
            )}
          >
            AM
          </button>
          <button
            onClick={setPm}
            className={cn(
              "text-xs font-bold px-2 py-1 rounded transition-colors",
              ampm === 'PM' ? "bg-[#facc15] text-black" : "bg-white/5 text-gray-400 hover:text-white"
            )}
          >
            PM
          </button>
        </div>
      </div>

      {/* Clock Face */}
      <div className="relative w-64 h-64 mx-auto my-2">
        <div className="absolute inset-0 rounded-full bg-[#1a1625] border border-white/10 shadow-inner" />
        
        {/* Center Point */}
        <div className="absolute top-1/2 left-1/2 w-2 h-2 -ml-1 -mt-1 bg-[#facc15] rounded-full z-20 shadow-[0_0_10px_rgba(250,204,21,0.5)]" />

        {/* Clock Hand */}
        <motion.div
          className="absolute top-1/2 left-1/2 w-0.5 h-[40%] bg-[#facc15] origin-bottom z-10 -ml-[1px] -mt-[40%]"
          initial={false}
          animate={{ rotate: getRotation() }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
        >
          <div className="absolute top-0 left-1/2 -ml-3 -mt-3 w-6 h-6 rounded-full bg-[#facc15] shadow-[0_0_15px_rgba(250,204,21,0.5)]" />
        </motion.div>

        {/* Numbers */}
        <div className="absolute inset-0">
          <AnimatePresence mode="wait">
            {mode === 'hours' ? (
              <motion.div
                key="hours"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.2 }}
                className="w-full h-full"
              >
                {hourNumbers.map((num, i) => {
                  const angle = (i * 30 - 90) * (Math.PI / 180); // Start at 12 (top)
                  const radius = 42; // percentage
                  const x = 50 + radius * Math.cos(angle);
                  const y = 50 + radius * Math.sin(angle);
                  
                  return (
                    <button
                      key={num}
                      data-hour={String(num)}
                      onClick={handleHourButtonClick}
                      className={cn(
                        "absolute w-10 h-10 -ml-5 -mt-5 rounded-full flex items-center justify-center font-bold transition-all z-20",
                        hours === num 
                          ? "text-black bg-[#facc15]" 
                          : "text-gray-400 hover:text-white hover:bg-white/10"
                      )}
                      style={{ left: `${x}%`, top: `${y}%` }}
                    >
                      {num}
                    </button>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div
                key="minutes"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.2 }}
                className="w-full h-full"
              >
                {minuteNumbers.map((num, i) => {
                  const angle = (i * 30 - 90) * (Math.PI / 180);
                  const radius = 42;
                  const x = 50 + radius * Math.cos(angle);
                  const y = 50 + radius * Math.sin(angle);
                  
                  return (
                    <button
                      key={num}
                      data-minute={String(num)}
                      onClick={handleMinuteButtonClick}
                      className={cn(
                        "absolute w-10 h-10 -ml-5 -mt-5 rounded-full flex items-center justify-center font-bold transition-all z-20",
                        minutes === num 
                          ? "text-black bg-[#facc15]" 
                          : "text-gray-400 hover:text-white hover:bg-white/10"
                      )}
                      style={{ left: `${x}%`, top: `${y}%` }}
                    >
                      {String(num).padStart(2, '0')}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <Button onClick={handleSave} className="w-full bg-[#facc15] text-black hover:bg-[#facc15]/90 font-bold rounded-xl mt-2">
        Set Time
      </Button>
    </div>
  );
}
