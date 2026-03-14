import './app.css';
import { mount } from 'svelte';
import PlayerApp from './player/PlayerApp.svelte';
import { registerPlayerEmbed } from './player-embed';

// Mount the standalone player page
mount(PlayerApp, { target: document.getElementById('player-root')! });

// Also register the <tedige-player> web component so that any page
// loading this script can use <tedige-player data="v4@..."> directly.
registerPlayerEmbed();
