
import mongoose, { isValidObjectId } from "mongoose"
import { Video } from "../models/video.modal.js"
import { User } from "../models/user.modal.js"
import { ApiError } from "../utils/ApiError.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"


const getAllVideos = asyncHandler(async (req, res) => {
    let { page = 1, limit = 10, query, sortBy = "createdAt", sortType = "desc", userId } = req.query;

    // convert to numbers
    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    // --- Match conditions ---
    const match = {};

    if (query) {
        match.$or = [
            { title: { $regex: query, $options: "i" } },
            { description: { $regex: query, $options: "i" } },
        ];
    }

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        match.owner = new mongoose.Types.ObjectId(userId);
    }

    // Only show published videos to public
    match.isPublished = true;

    // --- Sort conditions ---
    const sort = {};
    sort[sortBy] = sortType === "asc" ? 1 : -1;

    // --- Build aggregation ---
    const aggregateQuery = Video.aggregate([
        { $match: match },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "ownerDetails",
                pipeline: [
                    { $project: { username: 1, fullname: 1, avatar: 1 } }
                ],
            },
        },
        { $unwind: "$ownerDetails" },
        {
            $project: {
                title: 1,
                description: 1,
                videoFile: 1,
                thumbnail: 1,
                duration: 1,
                views: 1,
                isPublished: 1,
                createdAt: 1,
                ownerDetails: 1,
            },
        },
        { $sort: sort },
    ]);

    // --- Pagination with plugin ---
    const options = { page, limit };

    const videos = await Video.aggregatePaginate(aggregateQuery, options);

    return res
        .status(200)
        .json(new ApiResponse(200, videos, "Videos fetched successfully"));
});


const publishAVideo = asyncHandler(async (req, res) => {
    const { title, description } = req.body;
    const { videoFile, thumbnail } = req.files || {};

    // --- Basic validation ---
    if (!title?.trim() || !description?.trim()) {
        throw new ApiError(400, "Title and description are required");
    }

    if (!videoFile?.[0]?.path || !thumbnail?.[0]?.path) {
        throw new ApiError(400, "Video file and thumbnail are required");
    }

    const videoLocalPath = videoFile[0].path;
    const thumbnailLocalPath = thumbnail[0].path;

    let uploadedVideo, uploadedThumbnail;

    try {
        // --- Upload to Cloudinary ---
        uploadedVideo = await uploadOnCloudinary(videoLocalPath);
        uploadedThumbnail = await uploadOnCloudinary(thumbnailLocalPath);

        if (!uploadedVideo?.url) {
            throw new ApiError(500, "Video upload failed");
        }
        if (!uploadedThumbnail?.url) {
            throw new ApiError(500, "Thumbnail upload failed");
        }

        // --- Save video in DB ---
        const video = await Video.create({
            title: title.trim(),
            description: description.trim(),
            videoFile: uploadedVideo.url,
            thumbnail: uploadedThumbnail.url,
            duration: uploadedVideo.duration || 0,
            owner: req.user._id
        });

        return res
            .status(201)
            .json(new ApiResponse(201, video, "Video posted successfully"));
    } catch (error) {
        console.error("Video publishing failed:", error);
        throw new ApiError(
            error.statusCode || 500,
            error.message || "Something went wrong while publishing video"
        );
    }
});


const getVideoById = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    // --- Validate videoId ---
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
        throw new ApiError(400, "Invalid video ID");
    }

    const videoDetails = await Video.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(videoId),
            },
        },
        {
            $lookup: {
                from: "users",
                localField: "owner",
                foreignField: "_id",
                as: "ownerDetails",
                pipeline: [
                    { $project: { password: 0, refreshToken: 0, __v: 0 } }, // exclude sensitive fields
                ],
            },
        },
        {
            $unwind: "$ownerDetails", // flatten owner details
        },
        {
            $project: {
                title: 1,
                description: 1,
                videoFile: 1,
                thumbnail: 1,
                duration: 1,
                createdAt: 1,
                isPublished: 1,
                ownerDetails: {
                    _id: 1,
                    username: 1,
                    fullname: 1,
                    avatar: 1,
                },
            },
        },
    ]);

    if (!videoDetails.length) {
        throw new ApiError(404, "Video not found");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, videoDetails[0], "Video fetched successfully"));
});


const updateVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;
    const { title, description } = req.body;

    // --- Validate videoId ---
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
        throw new ApiError(400, "Invalid video ID");
    }

    // --- Find video ---
    const video = await Video.findById(videoId);
    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    // --- Prepare update data ---
    const updateData = {};
    if (title?.trim()) updateData.title = title.trim();
    if (description?.trim()) updateData.description = description.trim();

    // --- Handle thumbnail update ---
    if (req.file?.path) {

        const uploadedThumbnail = await uploadOnCloudinary(req.file.path);

        if (!uploadedThumbnail?.url) {
            throw new ApiError(500, "Thumbnail upload failed");
        }

        updateData.thumbnail = uploadedThumbnail.url;
    }

    // --- Update video ---
    const updatedVideo = await Video.findByIdAndUpdate(videoId, updateData, {
        new: true, // return updated doc
        runValidators: true, // run all validations from model like required true and all
    }).select("-__v");

    return res
        .status(200)
        .json(new ApiResponse(200, updatedVideo, "Video updated successfully"));
});


const deleteVideo = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    // --- Validate videoId ---
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
        throw new ApiError(400, "Invalid video ID");
    }

    // --- Find video ---
    const video = await Video.findById(videoId);
    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    // --- Ownership check (optional, but recommended) ---
    if (video.owner.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You are not authorized to delete this video");
    }

    // --- Delete from DB ---
    await Video.findByIdAndDelete(videoId);

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Video deleted successfully"));
});


const togglePublishStatus = asyncHandler(async (req, res) => {
    const { videoId } = req.params;

    // --- Validate videoId ---
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
        throw new ApiError(400, "Invalid video ID");
    }

    // --- Find the video ---
    const video = await Video.findById(videoId);
    if (!video) {
        throw new ApiError(404, "Video not found");
    }

    // --- Toggle publish status ---
    video.isPublished = !video.isPublished;

    await video.save({ validateBeforeSave: false }); // skip revalidation of unchanged fields

    return res.status(200).json(
        new ApiResponse(
            200,
            { isPublished: video.isPublished },
            `Video is now ${video.isPublished ? "published" : "unpublished"}`
        )
    );
});


export {
    getAllVideos,
    publishAVideo,
    getVideoById,
    updateVideo,
    deleteVideo,
    togglePublishStatus
}
