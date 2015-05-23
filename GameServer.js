// Library imports
var WebSocket = require('ws');

// Project imports
var Packet = require('./packet');
var PlayerTracker = require('./PlayerTracker');
var PacketHandler = require('./PacketHandler');
var Cell = require('./Cell');

//Library imports
var WebSocket = require('ws');

// Project imports
var Packet = require('./packet');
var PlayerTracker = require('./PlayerTracker');
var PacketHandler = require('./PacketHandler');
var Cell = require('./Cell');

// GameServer implementation
function GameServer(port) {
    this.border = {
        left: 0,
        right: 2000.0,
        //right: 11180.3398875,
        top: 0,
        // Debugging food/virus spawn
        bottom: 2000.0
        //bottom: 11180.3398875
    }; // Right: X increases, Down: Y increases (as of 2015-05-20)
    this.lastNodeId = 1;
    this.clients = [];
    this.port = port;
    this.nodes = [];
    this.nodesVirus = [];
    this.nodesPlayer = []; // Nodes controlled by players
    
    this.currentFood = 0;
    this.currentViruses = 0;
    this.movingNodes = [];
    this.leaderboard = [];
    this.leaderboardLowestScore = 0; // Lowest score in leaderboard
    
    this.config = {
    	foodSpawnRate: 1000, // The interval between each food cell spawn in milliseconds (Placeholder number)
    	foodSpawnAmount: 1, // The amount of food to spawn per interval
    	foodMaxAmount: 100, // Maximum food cells on the map (Placeholder number)
    	foodMass: 1, // Starting food size (In mass)
    	virusSpawnRate: 10000, // The interval between each virus spawn in milliseconds (Placeholder number)
    	virusMaxAmount: 2, //Maximum amount of viruses that can spawn randomly. Player made viruses do not count (Placeholder number)
    	virusStartMass: 100.0, // Starting virus size (In mass)
    	virusBurstMass: 198.0, // Viruses explode past this size
    	ejectMass: 16, //Mass of ejected cells
    	ejectMassGain: 14, //Amount of mass gained from consuming ejected cells
    	playerStartMass: 10, // Starting mass of the player cell
    	playerMinMassEject: 32, //Mass required to eject a cell
    	playerMinMassSplit: 36, //Mass required to split
    	playerMaxCells: 16, // Max cells the player is allowed to have
    	playerRecombineTime: 150, // Amount of ticks before a cell is allowed to recombine (1 tick = 200 milliseconds) - currently 30 seconds
    	playerMassDecayRate: .0005, // Amount of mass lost per tick (Multplier)(1 tick = 200 milliseconds)
    	playerMinMassDecay: 100, // Minimum mass for decay to occur
    	leaderboardUpdateInterval: 2000 // Time between leaderboard updates, in milliseconds
    };
	
	this.colors = [{'r':235,'b':0,'g':75},{'r':225,'b':255,'g':125},{'r':180,'b':20,'g':7},{'r':80,'b':240,'g':170},{'r':180,'b':135,'g':90},{'r':195,'b':0,'g':240},{'r':150,'b':255,'g':18},{'r':80,'b':0,'g':245},{'r':165,'b':0,'g':25},{'r':80,'b':0,'g':145},{'r':80,'b':240,'g':170},{'r':55,'b':255,'g':92}];
}

module.exports = GameServer;

GameServer.prototype.start = function() {
    this.socketServer = new WebSocket.Server({ port: this.port }, function() {
        console.log("[Game] Listening on port %d", this.port);
        setInterval(this.updateAll.bind(this), 100);
        setInterval(this.spawnFood.bind(this), this.config.foodSpawnRate);
        setInterval(this.spawnVirus.bind(this), this.config.virusSpawnRate);
        setInterval(this.updateMoveEngine.bind(this), 100);
        setInterval(this.updateLeaderboard.bind(this), this.config.leaderboardUpdateInterval);
        setInterval(this.updateCells.bind(this), 200);
    }.bind(this));

    this.socketServer.on('connection', connectionEstablished.bind(this));

    function connectionEstablished(ws) {
        function close(error) {
            console.log("[Game] Disconnect: %s:%d", this.socket.remoteAddress, this.socket.remotePort);
            var index = this.server.clients.indexOf(this.socket);
            if (index != -1) {
                this.server.clients.splice(index, 1);
            }

            if (this.socket.playerTracker.cells.length > 0) {
				var len = this.socket.playerTracker.cells.length;
				for (var i = 0; i < len; i++) {
					var cell = this.socket.playerTracker.cells[i];
					
					if (!cell) {
						continue;
					}
					
					this.server.removeNode(cell);
				}
            }
        }

        console.log("[Game] Connect: %s:%d", ws._socket.remoteAddress, ws._socket.remotePort);
        ws.remoteAddress = ws._socket.remoteAddress;
        ws.remotePort = ws._socket.remotePort;
        ws.playerTracker = new PlayerTracker(this, ws);
        ws.packetHandler = new PacketHandler(this, ws);
        ws.on('message', ws.packetHandler.handleMessage.bind(ws.packetHandler));

        var bindObject = { server: this, socket: ws };
        ws.on('error', close.bind(bindObject));
        ws.on('close', close.bind(bindObject));
        this.clients.push(ws);
    }
}

GameServer.prototype.getNextNodeId = function() {
    return this.lastNodeId++;
}

GameServer.prototype.getRandomPosition = function() {
    return {
        x: Math.floor(Math.random() * (this.border.right - this.border.left)) + this.border.left,
        y: Math.floor(Math.random() * (this.border.bottom - this.border.top)) + this.border.top
    };
}

GameServer.prototype.getRandomColor = function() {
	var index = Math.floor(Math.random() * this.colors.length);
	var color = this.colors[index];
	return {
        r: color.r,
        b: color.b,
        g: color.g
    };
}

GameServer.prototype.addNode = function(node) {
    this.nodes[node.nodeId] = node;
    
    switch (node.getType()) {
		case 0: // Add to special player controlled node list
            this.nodesPlayer.push(node);
            break;
		case 2: // Add to special virus node list
            this.nodesVirus.push(node);
            break;
		default:
            break;
    }
    
    //For each client connected, add the node to their addition queue
    for (var i = 0; i < this.clients.length; i++) {
        if (typeof this.clients[i] == "undefined") {
            continue;
        }

        this.clients[i].playerTracker.nodeAdditionQueue.push(node);
    }
}

GameServer.prototype.removeNode = function(node) {
	// Remove from main nodes list
    var index = this.nodes.indexOf(node);
    if (index != -1) {
        this.nodes.splice(index, 1);
    }
    
    // Remove from moving cells list
    index = this.movingNodes.indexOf(node);
    if (index != -1) {
    	this.movingNodes.splice(index, 1);
    }
    
	switch (node.getType()) {
        case 0: // Remove from owning player's cell list
            var owner = node.owner;
            owner.cells.splice(owner.cells.indexOf(node), 1);
            // Remove from special player controlled node list
            this.nodesPlayer.splice(this.nodesPlayer.indexOf(node), 1);
            break;
		case 2: // Remove from special virus node list
            this.nodesVirus.splice(this.nodesVirus.indexOf(node), 1);
            break;
		default:
            break;
    }


    for (var i = 0; i < this.clients.length; i++) {
        if (typeof this.clients[i] == "undefined") {
            continue;
        }

        this.clients[i].playerTracker.nodeDestroyQueue.push(node);
    }
}

GameServer.prototype.updateAll = function() {
    for (var i = 0; i < this.clients.length; i++) {
        if (typeof this.clients[i] == "undefined") {
            continue;
        }

        this.clients[i].playerTracker.update();
    }
}

GameServer.prototype.spawnFood = function() {
    for (var i = 0; i < this.config.foodSpawnAmount; i++) {
        if (this.currentFood < this.config.foodMaxAmount) {
            var f = new Cell(this.getNextNodeId(), null, this.getRandomPosition(), this.config.foodMass, 1);
            f.setColor(this.getRandomColor());
			
            this.addNode(f);
            this.currentFood++;
        }
	}    
}

GameServer.prototype.spawnVirus = function() {
    if (this.currentViruses < this.config.virusMaxAmount) {
        var f = new Cell(this.getNextNodeId(), null, this.getRandomPosition(), this.config.virusStartMass, 2);
        this.addNode(f);
        this.currentViruses++;
    }
}

GameServer.prototype.updateMoveEngine = function() {
	// A system to move cells not controlled by players (ex. viruses, ejected mass)
    for (var i = 0; i < this.movingNodes.length; i++) {
        var check = this.movingNodes[i];
    	
        // Recycle unused nodes
        while ((typeof check == "undefined") && (i < this.movingNodes.length)) {
            // Remove moving cells that are undefined
            this.movingNodes.splice(i, 1);
            check = movingNodes[i];
        }
        if (i >= this.movingNodes.length) {
            continue;
        }
        
        if (check.getMoveTicks() > 0) {
            // If the cell has enough move ticks, then move it
            check.calcMovePhys(this.border);
            if (check.getType() == 3) {
                // Check for viruses
                var v = this.getNearestVirus(check);
                if (v) {
                    // Feed the virus
                    v.setAngle(check.getAngle()); // Set direction if the virus explodes
                    v.mass += 14; // 7 cells to burst the virus
                    this.removeNode(check);
            		
                    // Check if the virus is going to explode
                    if (v.mass >= this.config.virusBurstMass) {
                        v.mass = this.config.virusStartMass; // Reset mass
                        this.virusBurst(v);
                    }
            		
                }
            }
        } else {
            // Set collision off
            check.setCollisionOff(false);
            // Remove cell from list
            var index = this.movingNodes.indexOf(check);
            if (index != -1) {
                this.movingNodes.splice(index, 1);
            }
        }
    }
}

GameServer.prototype.setAsMovingNode = function(node) {
	this.movingNodes.push(node);
}

GameServer.prototype.virusBurst = function(parent) {
	var parentPos = {
		x: parent.position.x,
		y: parent.position.y,
	};
	
    var	newVirus = new Cell(this.getNextNodeId(), null, parentPos, this.config.virusStartMass, 2);
    newVirus.setAngle(parent.getAngle());
    newVirus.setMoveEngineData(175, 10);
	
    // Add to moving cells list
    this.addNode(newVirus);
    this.setAsMovingNode(newVirus);
    this.currentViruses++;
}

GameServer.prototype.getCellsInRange = function(cell) {
    var list = new Array();
    var r = cell.getSize() * .9; // Get cell radius (Cell size = radius)
    var eatingRange = r * .75; // Distance between the 2 cells must be below this value for a cell to be eaten
	
    var topY = cell.position.y - r;
    var bottomY = cell.position.y + r;
	
    var leftX = cell.position.x - r;
    var rightX = cell.position.x + r;

    // Loop through all cells on the map. There is probably a more efficient way of doing this but whatever
	var len = this.nodes.length;
    for (var i = 0;i < len;i++) {
        var check = this.nodes[i];
		
        if (typeof check === 'undefined') {
            continue;
        }
		
        // Can't eat itself
        if (check.nodeId == cell.nodeId) {
            continue;
        }
		
        // Calculations (does not need to be 100% accurate right now)
        if (check.position.y > bottomY) {
            continue;
        } if (check.position.y < topY) {
            continue;
        } if (check.position.x > rightX) {
            continue;
        } if (check.position.x < leftX) {
            continue;
        } 
        
        // Cell type check
        var multiplier = 1.25; // Cell must be bigger than this number times the mass of the cell being eaten
		
        if (check.owner == cell.owner) {
            // Same owner
            multiplier = 1.00;
        }
		
        switch (check.getType()) {
            case 1: // Food cell
                break;
            case 2: // Virus
                multiplier = 1.33;
            default: // Other
                // Make sure the cell is big enough to be eaten.
                if ((check.mass * multiplier) > cell.mass) {
                    continue;
                }
            	
                // Eating range
                var xs = Math.pow(check.position.x - cell.position.x, 2);
                var ys = Math.pow(check.position.y - cell.position.y, 2);
                var dist = Math.sqrt( xs + ys );
                
                if (dist > eatingRange) {
                    // Not in eating range
                    continue;
                }
                break;
        }
		
        // Add to list of cells nearby
        list.push(check);
    }
    return list;
}

GameServer.prototype.getNearestVirus = function(cell) { 
	// More like getNearbyVirus
	var virus = null;
    var r = 100; // Checking radius
	
    var topY = cell.position.y - r;
    var bottomY = cell.position.y + r;
	
    var leftX = cell.position.x - r;
    var rightX = cell.position.x + r;

    // Loop through all viruses on the map. There is probably a more efficient way of doing this but whatever
	var len = this.nodesVirus.length;
    for (var i = 0;i < len;i++) {
        var check = this.nodesVirus[i];
		
        if (typeof check === 'undefined') {
            continue;
        }
		
        // Calculations (does not need to be 100% accurate right now)
        if (check.position.y > bottomY) {
            continue;
        } if (check.position.y < topY) {
            continue;
        } if (check.position.x > rightX) {
            continue;
        } if (check.position.x < leftX) {
            continue;
        } 
        		
        // Add to list of cells nearby
        virus = check;
    }
    return virus;
}

GameServer.prototype.updateLeaderboard = function() {
    this.leaderboard = []; // Clear the leaderboard first
    for (var i = 0; i < this.clients.length; i++) {
        if (typeof this.clients[i] == "undefined") {
            continue;
        }

        var player = this.clients[i].playerTracker;
        var playerScore = player.getScore(true);
        if (player.cells.length <= 0) {
            continue;
        }
        
        if (this.leaderboard.length == 0) {
            // Initial player
            this.leaderboard.push(player);
            continue;
        } else if (this.leaderboard.length < 10) {
            this.leaderboardAddSort(player);
        } else {
            // 10 in leaderboard already
            if (playerScore > this.leaderboard[9].getScore(false)) {
                this.leaderboard.pop();
                this.leaderboardAddSort(player);
            }
        }

    }
}

GameServer.prototype.leaderboardAddSort = function(player) {
    // Adds the player and sorts the leaderboard
    var len = this.leaderboard.length - 1;
    var loop = true;
    while ((len >= 0) && (loop)) {
        // Start from the bottom of the leaderboard
        if (player.getScore(false) <= this.leaderboard[len].getScore(false)) {
            this.leaderboard.splice(len + 1, 0, player);
            loop = false; // End the loop if a spot is found
        }
        len--;
    }
    if (loop) {
        // Add to top of the list because no spots were found
        this.leaderboard.splice(0, 0,player);
    }
}

GameServer.prototype.updateCells = function(){
    for (var i = 0; i < this.nodesPlayer.length; i++) {
        var cell = this.nodesPlayer[i];
        
        // Recombining
        if (cell.getRecombineTicks() > 0) {
            cell.setRecombineTicks(cell.getRecombineTicks() - 1);
        }
		
        // Mass decay
        if (cell.mass > this.config.playerMinMassDecay) {
            cell.mass *= (1 - this.config.playerMassDecayRate);
        }
    }
}

// Custom prototype functions
WebSocket.prototype.sendPacket = function(packet) {
    function getbuf(data) {
        var array = new Uint8Array(data.buffer || data);
        var l = data.byteLength || data.length;
        var o = data.byteOffset || 0;
        var buffer = new Buffer(l);

        for (var i = 0; i < l; i++) {
            buffer[i] = array[o + i];
        }

        return buffer;
    }

    if (this.readyState == WebSocket.OPEN && packet.build) {
        var buf = packet.build();
        this.send(getbuf(buf), { binary: true });
    }
}
