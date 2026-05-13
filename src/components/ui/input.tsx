import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-slate-200 bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
