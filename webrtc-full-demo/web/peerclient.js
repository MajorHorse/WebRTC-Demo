//
// Dove into Webrtc example for RTCPeerConnection
//

"use strict";

const mediaConstraints = {
  audio: {
    autoGainControl: true,
    echoCancellation: true,
    noiseSuppression: true
  },
  video: true
};
let myUsername = null;
let targetUserId = null;
let pc = null; // local RTCPeerConnection
let webcamStream = null; 
let chroma = null
let isConnected = false;
let usersArray = null;
let inviteUser = null;

const signaling_host = location.host;
const signaling_port = location.port || 443;
const roomID = 'signalingtestroom';
const peerID = makeRandomString(8);
const socketURL =  `/?roomId=${roomID}&peerId=${peerID}`;
let lastReadTime = 0;

let dcFile = null; // Data Channel for file trans
let channelId = 0;
let caller = false;
let selectedCodec = 'VP8';

const chatBox = document.querySelector(".chatbox");
const fileInput = document.querySelector('input#fileInput');
const textInput = document.querySelector('input#textInput');
const downloadAnchor = document.querySelector('a#download');
const sendProgress = document.querySelector('progress#sendProgress');
const receiveProgress = document.querySelector('progress#receiveProgress');
const sendFileButton = document.querySelector('button#sendFile');
const sendTextButton = document.querySelector('input#sendText');
const bitrateSpan = document.querySelector('span#bitrate');
fileInput.onchange = (e) => {
  sendFileButton.disabled = false;
}

textInput.onkeypress = (e) => {
  if(e.keyCode === 13 ) {
    handleSendButton();
  }
}


const signaling = new SignalingClient();
createPeerConnection();

class PeerFile {
  constructor(){}
  reset() {
    this.name = '';
    this.size = 0;
    this.buffer = [];
    this.receivedSize = 0;
    this.time = (new Date()).getTime();
  }
}

const receiveFile = new PeerFile();

function log(text) {
  console.log(text);
}

function error(text) {
  console.error(text);
}

function handleSendButton() {
  const text = textInput.value;
  if (!text.length) return;

  dcFile.send(JSON.stringify({
      text: text,
      method: 'message',
      id: peerID
    }
  ));
  textInput.value = '';

  const time = new Date();
  const timeString = `${time.getHours()}:${time.getMinutes()}`;
  const html = `<div class="sentMessage"><div><span style="font-size: x-small">${timeString}</span><b> ???</b></div><div><span class="sentText">${text}</span></div></div>`;
  chatBox.innerHTML += html;
  chatBox.scrollTop = chatBox.scrollHeight - chatBox.clientHeight;
}

function sendFile() {
  const file = fileInput.files[0];
  log("select file, name: " + file.name + " size: " + file.size);
  dcFile.send(JSON.stringify({
    method: 'file',
    name: file.name,
    size: file.size
  }));

  sendProgress.max = file.size;
  readFileData(file);
}

async function readFileData(file) {
  let offset = 0;
  let buffer = null;
  const chunkSize = pc.sctp.maxMessageSize;
  while(offset < file.size) {
    const slice = file.slice(offset, offset + chunkSize);
    buffer = await slice.arrayBuffer();
    if (dcFile.bufferedAmount > 65535) {
      // ????????????????????????????????????
      await new Promise(resolve => {
        dcFile.onbufferedamountlow = (ev) => {
          log("bufferedamountlow event! bufferedAmount: " + dcFile.bufferedAmount);
          resolve(0);
        }
      });
    }

    // ?????????????????????
    dcFile.send(buffer);
    offset += buffer.byteLength;
    sendProgress.value = offset;

    // ??????????????????
    const interval = (new Date()).getTime() - lastReadTime;
    bitrateSpan.textContent = `${Math.round(chunkSize * 8 /interval)}kbps`;
    lastReadTime = (new Date()).getTime();
  }
}

function newDataChannel() {
  log("*** Create Data Channel.");

  dcFile = pc.createDataChannel(peerID, {protocol: 'file', id: channelId++});
  dcFile.binaryType = 'arraybuffer';
  dcFile.bufferedAmountLowThreshold = 65536;
  log("new data channel , id: " + dcFile.id + ",binaryType: " + dcFile.binaryType + ", protocol: " + dcFile.protocol);
  setupDataChannelEvent(dcFile);
}

function connect() {
  log(`Connecting to signaling server: ${socketURL}`);
  signaling.connect(socketURL);
  signaling.onConnected = async () => {
    log('SocketIO client connected to signaling server!');
    const allusers = await signaling.sendRequest('join', {
      displayName: document.getElementById("name").value
    });

    if(allusers.peers && allusers.peers.length) {
      handleUserlistMsg(allusers.peers, true);
    } else if (allusers.joined) {
      log("You have joined!");
    }
  };

  signaling.onNewPeer = (msg) => {
    handleUserlistMsg([msg]);
  };

  signaling.onSdpOffer = (msg) => {
    handleVideoOfferMsg(msg);
  };

  signaling.onSdpAnswer = (msg) => {
    handleVideoAnswerMsg(msg);
  }

  signaling.onNewIceCandidate = (msg) => {
    handleNewICECandidateMsg(msg);
  };
}

function setupDataChannelEvent(channel) {
  channel.onopen = () => {
    log(`Data Channel opened !!! - '${channel.protocol}'`);
    fileInput.disabled = false;
    textInput.disabled = false;
    sendTextButton.disabled = false;
  }
  channel.onerror = (ev) => {
    const err = ev.error;
    error(`Data Channel '${channel.protocol}' error! ${err.errorDetail} - ${err.message}`);
  }

  channel.onmessage = (event) => {
    handleDataMessage(channel, event.data);
  }
}

function handleDataMessage(channel, data) {
    log(`Receive data channel message ,type: ${typeof(data)}`);
    if (typeof(data) === 'string') {
      // ?????????
      log(`Receive string data from '${channel.protocol}', data: ${data}`);
      const mess = JSON.parse(data);
      if(mess.method === 'file') {
        // ???????????????
        receiveFile.reset();
        receiveFile.name = mess.name;
        receiveFile.size = mess.size;
        receiveProgress.max = mess.size;
      } else if (mess.method === 'message') {
        // ????????????
        handleReceivedMessage(mess);
      }

      return;
    }

    // ??????????????????
    log(`Receive binary data from '${channel.protocol}', size: ${data.byteLength}`);
    receiveFile.buffer.push(data);
    receiveFile.receivedSize += data.byteLength;

    // ???????????????
    receiveProgress.value = receiveFile.receivedSize;

    // ??????????????????
    const interval = (new Date()).getTime() - receiveFile.time;
    bitrateSpan.textContent = ` ${Math.round(data.byteLength * 8 / interval)}kbps`;
    receiveFile.time = (new Date()).getTime();

    if(receiveFile.receivedSize === receiveFile.size) {
      // ?????????????????????????????????
      downloadFile(receiveFile);
    }
}

function handleReceivedMessage(msg) {
  const time = new Date();
  const timeString = `${time.getHours()}:${time.getMinutes()}`;
  const html = `<div><div><b>${msg.id} </b><span style="font-size: x-small">${timeString}</span></div><div><span class="receivedMessage">${msg.text}</span></div></div>`;
  log(html);
  chatBox.innerHTML += html;
  chatBox.scrollTop = chatBox.scrollHeight - chatBox.clientHeight;
}

function downloadFile(file) {
  const received = new Blob(file.buffer);

  downloadAnchor.href = URL.createObjectURL(received);
  downloadAnchor.download = file.name;
  downloadAnchor.textContent =
    `Click to download '${file.name}' (${file.size} bytes)`;
  downloadAnchor.style.display = 'block';
}

function createPeerConnection() {
  log("Setting up a connection...");

  pc = new RTCPeerConnection();
  // Set up event handlers for the ICE negotiation process.
  pc.onconnectionstatechange = handleConnectionStateChange;
  pc.onicecandidateerror = handleIceCandidateError;
  pc.onicecandidate = handleICECandidateEvent;
  pc.oniceconnectionstatechange = handleICEConnectionStateChangeEvent;
  pc.onicegatheringstatechange = handleICEGatheringStateChangeEvent;
  pc.onsignalingstatechange = handleSignalingStateChangeEvent;
  pc.onnegotiationneeded = handleNegotiationNeededEvent;
  pc.ontrack = handleTrackEvent;
  pc.ondatachannel = handleDataChannel;
}

function handleDataChannel(event) {
  const channel = event.channel;
  setupDataChannelEvent(channel);
  log("handle data channel event, id: " + channel.id + ",binaryType: " + channel.binaryType + ", protocol: " + channel.protocol);

  dcFile = channel;
  dcFile.binaryType = 'arraybuffer'
}

function handleConnectionStateChange() {
  log("*** Connection state changed to: " + pc.connectionState);
  switch (pc.connectionState) {
    case 'connected' :
      isConnected = true;
      document.getElementById('replace').disabled = false;
      document.getElementById('updateBitrate').disabled = false;
      break;
    case 'disconnected' :
      isConnected = false;
      break;
    case 'failed' :
      log("Connection failed, now restartIce()...");
      pc.restartIce();
      setTimeout(()=> {
        if(pc.iceConnectionState !== 'connected') {
          error("restartIce failed! close video call!" + "Connection state:" + pc.connectionState);
          closeVideoCall();
        }
      }, 10000);
      break;
  }
}

function handleIceCandidateError(event) {
  error("ICE Candidate Error, errCode: " + event.errorCode + " errorText: " + event.errorText);
}

async function handleNegotiationNeededEvent() {
  log("*** Negotiation needed");
  if (pc.signalingState != "stable") {
    log("-- The connection isn't stable yet; postponing...")
    return;
  }

  const codecCap = getCapabilitiesCodec(selectedCodec);
  try {
    pc.getTransceivers().forEach(t => {
      if(t.sender.track.kind !== 'video') return;
      t.setCodecPreferences(codecCap);
    });
  } catch(err) {
    error("setCodecPreferences error! " + err.name);
  }

  try {
    log("---> Setting local description to the offer");
		pc.createOffer().then(offer => {
			return pc.setLocalDescription(offer);
		}).then(() => {
			log("---> Sending the offer to the remote peer");
			signaling.sendRequest('sdpOffer', {
				from: peerID,
				to: inviteUser.id,
				sdp: pc.localDescription
			});
		});
  } catch(err) {
    log("*** The following error occurred while handling the negotiationneeded event:");
    reportError(err);
  };
}

function handleTrackEvent(event) {
  log("*** Track event");
  document.getElementById("received_video").srcObject = event.streams[0];
}

function handleICECandidateEvent(event) {
  if (event.candidate) {
    log("*** Outgoing ICE candidate: " + event.candidate.candidate);

    signaling.sendRequest('newIceCandidate', {
      from: peerID,
      to: inviteUser.id,
      candidate: event.candidate
    });
  }
}

function handleICEConnectionStateChangeEvent(event) {
  log("*** ICE connection state changed to " + pc.iceConnectionState);
}

function handleSignalingStateChangeEvent(event) {
  log("*** WebRTC signaling state changed to: " + pc.signalingState);
  switch(pc.signalingState) {
    case "stable":
      break;
    case "closed":
      closeVideoCall();
      break;
  }
}

function handleICEGatheringStateChangeEvent(event) {
  log("*** ICE gathering state changed to: " + pc.iceGatheringState);
}

function handleUserlistMsg(users, init=false) {
  log("Receive user list from server: " + JSON.stringify(users));
  const listElem = document.querySelector(".userlistbox");

  if (init) {
    usersArray = users;
    while (listElem.firstChild) {
      listElem.removeChild(listElem.firstChild);
    }
  } else {
    usersArray.push(...users);
  }

  users.forEach((user) => {
    let item = document.createElement("li");
    item.appendChild(document.createTextNode(user.displayName));
    item.addEventListener("click", () => invite(user.id), false);

    listElem.appendChild(item);
  });
}

function closeVideoCall() {
  const localVideo = document.getElementById("local_video");

  log("Closing the call");

  if (pc) {
    log("--> Closing the peer connection");

    pc.ontrack = null;
    pc.onnicecandidate = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;
    pc.onicegatheringstatechange = null;
    pc.onnotificationneeded = null;

    // Stop all transceivers on the connection
    pc.getTransceivers().forEach(transceiver => {
      transceiver.stop();
    });

    if (localVideo.srcObject) {
      localVideo.pause();
      localVideo.srcObject.getTracks().forEach(track => {
        track.stop();
      });
    }

    // Close the peer connection
    pc.close();
    pc = null;
    webcamStream = null;
  }

  targetUsername = null;
}

async function invite(id) {
  log("Starting to prepare an invitation");
  if (pc && (pc.connectionState === "connected")) {
    alert("???????????????????????????????????????????????????");
    return;
  } 

  if (id === peerID) {
    alert("??????????????????!");
    return;
  }

  log("Getting local camera...");
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    document.getElementById("local_video").srcObject = webcamStream;
  } catch(err) {
    handleGetUserMediaError(err);
    return;
  }

  caller = true;
  inviteUser = usersArray.find(user => user.id === id);
  log("Setting up connection to invite user: " + inviteUser.displayName);

  try {
    webcamStream.getTracks().forEach(
      track => pc.addTrack(track, webcamStream)
    );
  } catch(err) {
    handleGetUserMediaError(err);
  }

  newDataChannel();
}

async function handleVideoOfferMsg(msg) {
  const fromUser = usersArray.find(user => user.id === msg.from);
  const toUser = usersArray.find(user => user.id === msg.to);
  inviteUser = fromUser;

  log("Received video chat offer from " + fromUser.displayName + " to " + toUser.displayName);

  if (pc.signalingState != "stable") {
    log("  - But the signaling state isn't stable, so triggering rollback");

    // Set the local and remove descriptions for rollback; don't proceed
    // until both return.
    await Promise.all([
      pc.setLocalDescription({type: "rollback"}),
      pc.setRemoteDescription(msg.sdp)
    ]);
    return;
  } else {
    log ("  - Setting remote description");
    await pc.setRemoteDescription(msg.sdp);
  }

  if (!webcamStream) {
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    } catch(err) {
      handleGetUserMediaError(err);
      return;
    }

    document.getElementById("local_video").srcObject = webcamStream;

    try {
      webcamStream.getTracks().forEach(
        track => pc.addTrack(track, webcamStream)
      );
    } catch(err) {
      handleGetUserMediaError(err);
    }
  }

  log("---> Creating and sending answer to caller");

	await pc.createAnswer().then(offer => {
		return pc.setLocalDescription(offer);
	});

	signaling.sendRequest('sdpAnswer', {
		from: peerID,
		to: fromUser.id,
		sdp: pc.localDescription
	});

}

async function handleVideoAnswerMsg(msg) {
  const fromUser = usersArray.find(user => user.id === msg.from);
  log("*** Receive video chat answer from: " + fromUser.displayName);
  await pc.setRemoteDescription(msg.sdp).catch(reportError);
}

async function handleNewICECandidateMsg(msg) {
  const fromUser = usersArray.find(user => user.id === msg.from);
  log("*** Receive ice candidate from: " + fromUser.displayName);
  log("*** Received ICE candidate: " + JSON.stringify(msg.candidate));
  try {
    await pc.addIceCandidate(msg.candidate)
  } catch(err) {
    reportError(err);
  }
}

function handleGetUserMediaError(e) {
  error(e);
  switch(e.name) {
    case "NotFoundError":
      alert("Unable to open your call because no camera and/or microphone" +
            "were found.");
      break;
    case "SecurityError":
    case "PermissionDeniedError":
      break;
    default:
      alert("Error opening your camera and/or microphone: " + e.message);
      break;
  }

  closeVideoCall();
}

function reportError(errMessage) {
  error(`Error ${errMessage.name}: ${errMessage.message}`);
}

function updateBitrate() {
  if(!pc || !isConnected) return;
  let ele = document.getElementById('bitrateInput');
  let bitrate = document.getElementById('bitrateInput').value;
  log("* Set MaxBitrate to : " + bitrate + "kbps");
  bitrate = bitrate * 1024;

  pc.getSenders().forEach(sender => {
    if(sender.track.kind === 'audio') return;

    let param = sender.getParameters();
    param.encodings[0].maxBitrate = bitrate;
    sender.setParameters(param)
    .then(() => {
      param = sender.getParameters();
      log(" * Video Sender Encodings * ");
      const senderParamsEncoding = param.encodings.map(encoding => JSON.stringify(encoding)).join("\n");
      log(senderParamsEncoding);
    })
    .catch(error => {
      error("Set MaxBitrate error! " + error.name);
    });
  });
}

function selectCodec() {
  selectedCodec = document.getElementById("codecSelect").value;
  log("* Select codec : " + selectedCodec);

  if (isConnected) {
    pc.restartIce();
  }
}

function getCapabilitiesCodec(codec) {
  let capCodes = RTCRtpSender.getCapabilities('video').codecs;
  let cap = null;
  switch(codec) {
    case 'VP8':
    case 'VP9':
      cap = capCodes.find(item => item.mimeType.match(codec));
      break;
    case 'H264':
      cap = capCodes.find(item => item.mimeType.match(codec) && item.sdpFmtpLine.match('42e01f'));
  }

  capCodes = capCodes.filter(item => item !== cap);
  capCodes = [cap, ...capCodes];
  log("Sorted Capabilities =>" + JSON.stringify(capCodes));
  return capCodes;
}

function replaceBackground() {
  if (!isConnected) return;

  if (!chroma) {
    chroma = new ChromaKey();
    chroma.doLoad();
  }

  const checkBox = document.getElementById('replace');
  if (checkBox.checked) {
    log("replace background checked!");
    const chromaTrack = chroma.capStream.getVideoTracks()[0];
    pc.getSenders().forEach(sender => {
      if(sender.track.kind !== 'video') return;
      sender.replaceTrack(chromaTrack);
    });
    document.getElementById("chroma_video").srcObject = chroma.capStream;
  } else {
    log("replace background unchecked!");
    const cameraTrack = webcamStream.getVideoTracks()[0];
    pc.getSenders().forEach(sender => {
      if(sender.track.kind !== 'video') return;
      sender.replaceTrack(cameraTrack);
    });
    document.getElementById("chroma_video").srcObject = webcamStream;
  }
}

function makeRandomString(length) {
  let outString = '';
  const inOptions = 'abcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < length; i++) {
    outString += inOptions.charAt(Math.floor(Math.random() * inOptions.length));
  }

  return outString;
};
