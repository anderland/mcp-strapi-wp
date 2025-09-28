'use client';

import React from 'react';

import {
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react';
import { ChevronUpDownIcon } from '@heroicons/react/16/solid';
import { CheckIcon } from '@heroicons/react/20/solid';

const PROVIDER_OPTIONS = [
  { value: 'strapi', label: 'Strapi' },
  { value: 'wp', label: 'WordPress' },
];

export default function Select({
  value,
  onChange,
  id = 'provider',
  name = 'provider',
  className = '',
  options = undefined,
  children,
}) {
  const optionsFromChildren = React.Children.toArray(children)
    .map((child) => {
      const val = child?.props?.value;
      if (typeof val === 'undefined') return null;
      const lbl = child?.props?.children ?? String(val);
      return { value: val, label: lbl };
    })
    .filter(Boolean);

  const OPTS =
    optionsFromChildren.length > 0
      ? optionsFromChildren
      : Array.isArray(options) && options.length > 0
      ? options
      : PROVIDER_OPTIONS;

  const selected =
    OPTS.find((o) => String(o.value) === String(value)) ?? OPTS[0];

  const handleChange = (nextOption) => {
    onChange?.(nextOption.value);
  };

  return (
    <div className='w-40'>
      <input type='hidden' name={name} value={selected.value} />

      <Listbox value={selected} onChange={handleChange}>
        <div className='relative mt-0'>
          <ListboxButton
            id={id}
            className={[
              'grid w-full cursor-default grid-cols-1 rounded-md bg-white py-2 pr-3 pl-3 text-left text-sm leading-6 text-gray-900',
              'outline-1 -outline-offset-1 outline-gray-300 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600',
              'dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus-visible:outline-blue-500',
              className,
            ].join(' ')}
          >
            <span className='col-start-1 row-start-1 flex w-full text-[16px] gap-2 pr-6'>
              <span className='truncate'>{selected.label}</span>
            </span>
            <ChevronUpDownIcon
              aria-hidden='true'
              className='col-start-1 row-start-1 size-5 self-center justify-self-end text-gray-500 sm:size-4 dark:text-gray-400'
            />
          </ListboxButton>

          <ListboxOptions
            transition
            className='absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg outline-1 outline-black/5 data-leave:transition data-leave:duration-100 data-leave:ease-in data-closed:data-leave:opacity-0 sm:text-sm dark:bg-gray-800 dark:shadow-none dark:-outline-offset-1 dark:outline-white/10'
          >
            {OPTS.map((opt) => (
              <ListboxOption
                key={opt.value}
                value={opt}
                className='group relative cursor-default select-none py-2 pr-9 pl-3 text-gray-900 data-focus:bg-blue-600 data-focus:text-white data-focus:outline-hidden dark:text-white dark:data-focus:bg-blue-500'
              >
                <span className='truncate font-normal text-[16px] group-data-selected:font-semibold'>
                  {opt.label}
                </span>

                <span className='absolute inset-y-0 right-0 hidden items-center pr-4 text-blue-600 group-data-selected:flex group-data-focus:text-white dark:text-blue-400'>
                  <CheckIcon aria-hidden='true' className='size-5' />
                </span>
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
    </div>
  );
}
