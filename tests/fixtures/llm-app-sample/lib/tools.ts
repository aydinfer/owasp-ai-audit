import { tool } from 'ai';
import { z } from 'zod';

// AI SDK tool definition — gives the model an outbound capability.
export const getWeather = tool({
  description: 'Get the weather for a city',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => {
    const r = await fetch(`https://api.example.com/weather?city=${city}`);
    return r.json();
  },
});
