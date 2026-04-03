let webSocket = null;
let requestId = 0;

const OBS_DEFAULT = {
    obsHost: "127.0.0.1",
    obsPort: 4455,
    obsPassword: "",
    obsInputName: "NowPlaying"
}

let OBS_SETTINGS = {
    inputName: OBS_DEFAULT.inputName
}

async function obsOnHello(d) {
  const rpcVersion = d.rpcVersion;
  const payload = {rpcVersion, eventSubscriptions: 0};
  if(webSocket.readyState == WebSocket.OPEN) {
    webSocket.send(JSON.stringify({ op: 1, d: payload}));
  }
}

function connect() {
  webSocket = new WebSocket('ws://127.0.0.1:4455');

  webSocket.onopen = (event) => {
    console.log('IDDQD websocket open');
    // keepAlive();
  };

  webSocket.onmessage = async (event) => {
    console.log(`IDDQD websocket received message: ${event.data}`);
    let msg;
    msg = JSON.parse(event.data);
    if(msg.op === 0) {
        await obsOnHello(msg.d);
        return;
    } else if(msg.op === 2){
        sendTextToOBS("ABOBA");
    }
    requestId++;
  };

  webSocket.onclose = (event) => {
    console.log('IDDQD websocket connection closed');
    webSocket = null;
  };
}

function disconnect() {
  if (webSocket == null) {
    return;
  }
  webSocket.close();
}

function sendTextToOBS(message){
    let inputName = "NowPlaying";
    webSocket.send(
        JSON.stringify({
            op: 6,
            d: {
                requestType: "SetInputSettings",
                requestId: requestId,
                requestData: {
                    inputName,
                    inputSettings: { text: message.toString('utf-8').trim()},
                    overlay: true,
                }
            }
        })
    );

}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // if (!webSocket || webSocket.readyState == WebSocket.CLOSED) {
    //     connect();
    // }

    console.log("IDDQD", message, sender);
    if(sender.tab.audible){
        const song = message.song;
        sendTextToOBS(song);
    }
});

setTimeout(connect(), 1000);