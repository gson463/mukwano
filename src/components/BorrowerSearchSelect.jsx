import React, { useState } from 'react';
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function BorrowerSearchSelect({ borrowers = [], value, onChange, placeholder = "Select borrower..." }) {
  const [open, setOpen] = useState(false);

  const selectedBorrower = borrowers.find((b) => b.id === value);

  const handleClear = (e) => {
    e.stopPropagation();
    onChange(null);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-11 px-3 text-left font-normal bg-white border-gray-200 hover:bg-gray-50 hover:text-gray-900 transition-colors group"
        >
          {selectedBorrower ? (
             <div className="flex flex-col items-start truncate pr-4 flex-1">
                <span className="font-semibold text-sm truncate text-gray-900">{selectedBorrower.first_name} {selectedBorrower.surname}</span>
                <span className="text-xs text-gray-500 truncate">{selectedBorrower.borrower_id} • {selectedBorrower.phone_number}</span>
             </div>
          ) : (
            <span className="text-gray-500">{placeholder}</span>
          )}
          
          <div className="flex items-center gap-1">
            {selectedBorrower && (
                <div 
                    role="button"
                    onClick={handleClear}
                    className="p-1 rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors opacity-0 group-hover:opacity-100"
                    title="Clear selection"
                >
                    <X className="h-3 w-3" />
                </div>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0 shadow-lg border-0" align="start">
        <Command 
          className="rounded-lg border shadow-md"
          filter={(value, search) => {
             if (value.toLowerCase().includes(search.toLowerCase())) return 1;
             return 0;
          }}
        >
          <CommandInput placeholder="Search name, ID, phone..." className="h-11" />
          <CommandEmpty className="py-6 text-center text-sm text-gray-500">No borrower found.</CommandEmpty>
          <CommandGroup className="max-h-[300px] overflow-y-auto">
            {borrowers.map((borrower) => {
               // Combine fields for search
               const searchString = `${borrower.first_name} ${borrower.surname} ${borrower.borrower_id} ${borrower.phone_number}`;
               const isSelected = value === borrower.id;
               return (
                <CommandItem
                    key={borrower.id}
                    value={searchString} 
                    onSelect={() => {
                        onChange(borrower.id);
                        setOpen(false);
                    }}
                    className="cursor-pointer aria-selected:bg-primary/10 aria-selected:text-foreground py-3 border-b border-gray-50 last:border-0"
                >
                    <Check
                        className={cn(
                            "mr-2 h-4 w-4 text-primary transition-opacity",
                            isSelected ? "opacity-100" : "opacity-0"
                        )}
                    />
                    <div className="flex flex-col">
                        <span className={cn("font-medium", isSelected ? "text-foreground" : "text-gray-900")}>
                            {borrower.first_name} {borrower.surname}
                        </span>
                        <span className={cn("text-xs", isSelected ? "text-primary" : "text-gray-500")}>
                            {borrower.borrower_id} • {borrower.phone_number}
                        </span>
                    </div>
                </CommandItem>
            )})}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}