// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title BlockStarName
 * @dev NFT contract for @name identities on BlockStar Messenger
 * Each NFT represents a unique @name that can be used as identity
 */
contract BlockStarName is ERC721, ERC721URIStorage, Ownable {
    using Strings for uint256;

    // Counter for token IDs
    uint256 private _tokenIdCounter;

    // Mapping from @name to token ID
    mapping(string => uint256) public nameToTokenId;
    
    // Mapping from token ID to @name
    mapping(uint256 => string) public tokenIdToName;
    
    // Mapping to track if a name is taken
    mapping(string => bool) public nameTaken;
    
    // Price to mint an @name NFT
    uint256 public mintPrice;
    
    // Base URI for token metadata
    string private _baseTokenURI;
    
    // Events
    event NameMinted(address indexed owner, uint256 indexed tokenId, string name);
    event NameTransferred(address indexed from, address indexed to, uint256 indexed tokenId, string name);
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);

    constructor(
        uint256 _mintPrice,
        string memory baseURI
    ) ERC721("BlockStar Name", "BSN") Ownable(msg.sender) {
        mintPrice = _mintPrice;
        _baseTokenURI = baseURI;
    }

    /**
     * @dev Mint a new @name NFT
     * @param name The desired @name (without @ symbol)
     */
    function mintName(string memory name) public payable returns (uint256) {
        require(msg.value >= mintPrice, "Insufficient payment");
        require(bytes(name).length >= 3 && bytes(name).length <= 20, "Name must be 3-20 characters");
        require(!nameTaken[name], "Name already taken");
        require(isValidName(name), "Invalid name format");

        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;

        // Mark name as taken
        nameTaken[name] = true;
        nameToTokenId[name] = tokenId;
        tokenIdToName[tokenId] = name;

        // Mint NFT
        _safeMint(msg.sender, tokenId);
        
        // Set token URI
        string memory uri = string(abi.encodePacked(_baseTokenURI, tokenId.toString()));
        _setTokenURI(tokenId, uri);

        emit NameMinted(msg.sender, tokenId, name);

        return tokenId;
    }

    /**
     * @dev Check if a name is valid (alphanumeric and underscore only)
     * @param name The name to validate
     */
    function isValidName(string memory name) public pure returns (bool) {
        bytes memory nameBytes = bytes(name);
        
        for (uint i = 0; i < nameBytes.length; i++) {
            bytes1 char = nameBytes[i];
            
            // Allow a-z, A-Z, 0-9, and underscore
            if (!(
                (char >= 0x30 && char <= 0x39) || // 0-9
                (char >= 0x41 && char <= 0x5A) || // A-Z
                (char >= 0x61 && char <= 0x7A) || // a-z
                (char == 0x5F)                     // underscore
            )) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * @dev Check if a name is available
     * @param name The name to check
     */
    function isNameAvailable(string memory name) public view returns (bool) {
        return !nameTaken[name] && isValidName(name) && bytes(name).length >= 3 && bytes(name).length <= 20;
    }

    /**
     * @dev Get the @name for a wallet address
     * @param owner The wallet address
     */
    function getNameByAddress(address owner) public view returns (string memory) {
        uint256 balance = balanceOf(owner);
        require(balance > 0, "No name owned");
        
        // Return first name owned
        uint256 tokenId = tokenOfOwnerByIndex(owner, 0);
        return tokenIdToName[tokenId];
    }

    /**
     * @dev Get the wallet address for an @name
     * @param name The @name to lookup
     */
    function getAddressByName(string memory name) public view returns (address) {
        require(nameTaken[name], "Name not found");
        uint256 tokenId = nameToTokenId[name];
        return ownerOf(tokenId);
    }

    /**
     * @dev Update mint price (only owner)
     * @param newPrice The new mint price
     */
    function updateMintPrice(uint256 newPrice) public onlyOwner {
        uint256 oldPrice = mintPrice;
        mintPrice = newPrice;
        emit PriceUpdated(oldPrice, newPrice);
    }

    /**
     * @dev Update base URI (only owner)
     * @param newBaseURI The new base URI
     */
    function updateBaseURI(string memory newBaseURI) public onlyOwner {
        _baseTokenURI = newBaseURI;
    }

    /**
     * @dev Withdraw contract balance (only owner)
     */
    function withdraw() public onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No balance to withdraw");
        payable(owner()).transfer(balance);
    }

    /**
     * @dev Get total supply of minted names
     */
    function totalSupply() public view returns (uint256) {
        return _tokenIdCounter;
    }

    /**
     * @dev Override transferFrom to handle name transfer
     */
    function transferFrom(address from, address to, uint256 tokenId) public override(ERC721, IERC721) {
        super.transferFrom(from, to, tokenId);
        emit NameTransferred(from, to, tokenId, tokenIdToName[tokenId]);
    }

    /**
     * @dev Override safeTransferFrom to handle name transfer
     */
    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) 
        public 
        override(ERC721, IERC721) 
    {
        super.safeTransferFrom(from, to, tokenId, data);
        emit NameTransferred(from, to, tokenId, tokenIdToName[tokenId]);
    }

    // Override required functions
    function tokenURI(uint256 tokenId) 
        public 
        view 
        override(ERC721, ERC721URIStorage) 
        returns (string memory) 
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _burn(uint256 tokenId) internal override(ERC721, ERC721URIStorage) {
        super._burn(tokenId);
    }
}
