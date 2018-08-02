/*@flow*/
'use strict';

const Fs = require('fs');

const Irc = require('irc');
const BinTrees = require('bintrees');

const bot = (name, config) => {
    const readChans = (cb) => {
        Fs.readFile('./chans-' + name + '.ndjson', 'utf8', (err, ret) => {
            if (err && err.code === 'ENOENT') { return void cb([]); }
            if (err) { throw err; }
            const chans = {};
            ret.split('\n').forEach((l) => {
                if (l === '') { return; }
                try {
                    const d = JSON.parse(l);
                    if (d.type === 'INVITE') { chans[d.chan] = true; }
                    if (d.type === 'KICK') { delete chans[d.chan]; }
                } catch (e) {
                    console.log('bad line [' + l + ']');
                }
            });
            cb(Object.keys(chans));
        });
    };
    const toVoiceNow = new BinTrees.RBTree((a, b) => {
        const ret = (a.date - b.date);
        if (!ret) {
            const aa = JSON.stringify(a);
            const bb = JSON.stringify(b);
            if (aa === bb) { return 0; }
            return aa < bb ? -1 : 1;
        }
        return ret;
    });
    const channels = {};
    const getChan = (chan) => {
        const out = channels[chan];
        if (out) { return out; }
        return (channels[chan] = {
            hasOps: false,
            toVoice: []
        });
    };
    const addToVoice = (chan, nick) => {
        const obj = { date: +new Date(), chan: chan, nick: nick };
        const ch = getChan(chan);
        if (ch.hasOps) {
            toVoiceNow.insert(obj);
        } else {
            console.log('will voice with ops', obj);
            ch.toVoice.push(obj);
        }
    };
    
    
    const file = Fs.createWriteStream('./chans' + name + '.ndjson', { flags: 'a' });
    const writeOp = (type, chan) => {
        file.write(JSON.stringify({ date: +new Date(), type: type, chan: chan }) + '\n');
    };
    
    readChans((chans) => {
        let ircClient = new Irc.Client(config.ircServerHost, config.ircNick, {
            debug: true,
            channels: chans,
            floodProtection: true,
            floodProtectionDelay: 2000,
            userName: config.userName,
            realName: config.realName
        });
        ircClient.addListener('error', (message) => {
            console.log('irc> error: ', message);
        });
        ircClient.addListener('names', (channel, nicks) => {
            Object.keys(nicks).filter((n) => (nicks[n] === '')).forEach((n) => {
                //if (n === ircClient.nick) { return; }
                addToVoice(channel, n);
            });
        });
        ircClient.addListener('join', (channel, nick) => {
            console.log('join', channel, nick);
            //if (nick === ircClient.nick) { return; }
            addToVoice(channel, nick);
        });
        ircClient.addListener('invite', (channel) => {
            writeOp('INVITE', channel);
            ircClient.join(channel);
        });
        ircClient.addListener('kick', (channel, whoKicked) => {
            if (whoKicked !== ircClient.nick) { return; }
            writeOp('KICK', channel);
        });
        ircClient.addListener('+mode', (channel, by, mode, arg) => {
            //console.log('+mode', channel, by, mode, arg, ircClient.nick);
            if (mode !== 'o' || arg !== ircClient.nick) { return; }
            const chan = getChan(channel);
            console.log("Got ops in", channel);
            chan.hasOps = true;
            chan.toVoice.forEach((u) => {
                console.log('toVoiceNow', u);
                toVoiceNow.insert(u);
            });
            chan.toVoice = [];
        });
        setInterval(() => {
            const next = toVoiceNow.min();
            //if (next) { console.log(next, toVoiceNow.size); }
            if (!next || (new Date() - next.date) < 30000) { return; }
            if (next.nick !== ircClient.nick) {
                ircClient.send('MODE', next.chan, '+v', next.nick);
            }
            toVoiceNow.remove(next);
        }, 1000);
    });    
};

const main = () => {
    let Config = require('./config.example.js');
    // $FlowFixMe
    try { Config = require('./config.js'); } catch (e) { }
    Object.keys(Config).forEach((name) => {
        bot(name, Config[name]);
    });
};
main();