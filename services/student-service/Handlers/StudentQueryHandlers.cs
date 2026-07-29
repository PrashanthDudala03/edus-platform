using MediatR;
using StudentService.Data;
using StudentService.Models;

namespace StudentService.Handlers;

public class GetStudentListQuery : IRequest<StudentListResponse>
{
    public required Guid SchoolId { get; set; }
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 20;
}

public class GetStudentListHandler : IRequestHandler<GetStudentListQuery, StudentListResponse>
{
    private readonly IStudentRepository _studentRepository;

    public GetStudentListHandler(IStudentRepository studentRepository)
    {
        _studentRepository = studentRepository;
    }

    public async Task<StudentListResponse> Handle(GetStudentListQuery request, CancellationToken cancellationToken)
    {
        var (students, totalCount) = await _studentRepository.GetBySchoolAsync(
            request.SchoolId, request.Page, request.PageSize);

        return new StudentListResponse
        {
            Page = request.Page,
            PageSize = request.PageSize,
            TotalCount = totalCount,
            Data = students.Select(s => s.ToDto()).ToList(),
        };
    }
}

public class GetStudentCountQuery : IRequest<int>
{
    public required Guid SchoolId { get; set; }
}

public class GetStudentCountHandler : IRequestHandler<GetStudentCountQuery, int>
{
    private readonly IStudentRepository _studentRepository;

    public GetStudentCountHandler(IStudentRepository studentRepository)
    {
        _studentRepository = studentRepository;
    }

    public async Task<int> Handle(GetStudentCountQuery request, CancellationToken cancellationToken)
    {
        return await _studentRepository.GetCountAsync(request.SchoolId);
    }
}
